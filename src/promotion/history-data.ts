import { readdir, readFile, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

import { resizeImage } from "@earendil-works/pi-coding-agent";
import * as XLSX from "xlsx";

const SPREADSHEET_EXTENSIONS = new Set([".xls", ".xlsx", ".csv", ".tsv"]);
const TEXT_EXTENSIONS = new Set([".json", ".md", ".txt"]);
const IMAGE_MIME_TYPES = new Map([
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);
const MAX_HISTORY_TEXT_BYTES = 4 * 1024 * 1024;

export type HistoryImage = {
  type: "image";
  mimeType: string;
  data: string;
};

export type PromotionHistory = {
  text: string;
  images: HistoryImage[];
  fileCount: number;
  spreadsheetCount: number;
  imageCount: number;
};

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries
    .filter((entry) => !entry.name.startsWith("."))
    .map(async (entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? await listFiles(path) : [path];
    }));
  return files.flat().sort((left, right) => left.localeCompare(right));
}

function spreadsheetText(path: string, contents: Buffer): string {
  const workbook = XLSX.read(contents, { type: "buffer", cellDates: true });
  const sheets = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return `## Sheet: ${sheetName}\n(empty)`;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false }).trim();
    return `## Sheet: ${sheetName}\n${csv || "(empty)"}`;
  });
  if (sheets.length === 0) throw new Error(`spreadsheet contains no sheets: ${path}`);
  return sheets.join("\n\n");
}

function appendBounded(chunks: string[], value: string, currentBytes: number): number {
  const valueBytes = Buffer.byteLength(value, "utf8");
  if (currentBytes + valueBytes > MAX_HISTORY_TEXT_BYTES) {
    throw new Error(`history data exceeds the ${MAX_HISTORY_TEXT_BYTES}-byte runtime prompt limit`);
  }
  chunks.push(value);
  return currentBytes + valueBytes;
}

export async function loadPromotionHistory(cwd: string, dataDirectory: string): Promise<PromotionHistory> {
  const root = resolve(cwd, dataDirectory);
  const rootStats = await stat(root).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`history data directory does not exist: ${dataDirectory}`);
    }
    throw error;
  });
  if (!rootStats.isDirectory()) throw new Error(`history data path is not a directory: ${dataDirectory}`);

  const paths = await listFiles(root);
  const textChunks: string[] = [];
  const images: HistoryImage[] = [];
  let textBytes = 0;
  let spreadsheetCount = 0;
  let includedFileCount = 0;

  for (const path of paths) {
    const extension = extname(path).toLocaleLowerCase();
    const name = relative(root, path);
    if (SPREADSHEET_EXTENSIONS.has(extension)) {
      const contents = await readFile(path);
      const block = `<history-file name=${JSON.stringify(name)}>\n${spreadsheetText(path, contents)}\n</history-file>\n`;
      textBytes = appendBounded(textChunks, block, textBytes);
      spreadsheetCount += 1;
      includedFileCount += 1;
      continue;
    }
    if (TEXT_EXTENSIONS.has(extension)) {
      const block = `<history-file name=${JSON.stringify(name)}>\n${await readFile(path, "utf8")}\n</history-file>\n`;
      textBytes = appendBounded(textChunks, block, textBytes);
      includedFileCount += 1;
      continue;
    }
    const mimeType = IMAGE_MIME_TYPES.get(extension);
    if (mimeType) {
      const contents = await readFile(path);
      const resized = await resizeImage(contents, mimeType, {
        maxWidth: 2_000,
        maxHeight: 2_000,
        maxBytes: 4 * 1024 * 1024,
      });
      images.push({
        type: "image",
        mimeType: resized?.mimeType ?? mimeType,
        data: resized?.data ?? contents.toString("base64"),
      });
      const block = `<history-image name=${JSON.stringify(name)} attachment-index=${images.length - 1}></history-image>\n`;
      textBytes = appendBounded(textChunks, block, textBytes);
      includedFileCount += 1;
    }
  }

  if (includedFileCount === 0) {
    throw new Error(`history data directory contains no supported files: ${dataDirectory}`);
  }
  return {
    text: textChunks.join("\n"),
    images,
    fileCount: includedFileCount,
    spreadsheetCount,
    imageCount: images.length,
  };
}

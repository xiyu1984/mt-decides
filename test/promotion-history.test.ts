import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as XLSX from "xlsx";

import { loadPromotionHistory } from "../src/promotion/history-data.js";

async function writeWorkbook(path: string, bookType: "biff8" | "xlsx", rows: unknown[][]): Promise<void> {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "历史数据");
  const contents = XLSX.write(workbook, { bookType, type: "buffer" });
  await writeFile(path, contents);
}

test("loads legacy and OOXML spreadsheets as runtime LLM text", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "promotion-history-"));
  try {
    const dataDir = join(cwd, "resources", "data");
    await mkdir(join(dataDir, "nested"), { recursive: true });
    await writeWorkbook(join(dataDir, "plan.xlsx"), "xlsx", [["日期", "预算"], ["2026-08-08", 120]]);
    await writeWorkbook(join(dataDir, "nested", "traffic.xls"), "biff8", [["访客", 42]]);
    await writeFile(join(dataDir, "notes.txt"), "仅作为历史上下文", "utf8");
    await writeFile(join(dataDir, ".DS_Store"), "ignored", "utf8");

    const history = await loadPromotionHistory(cwd, "resources/data");

    assert.equal(history.fileCount, 3);
    assert.equal(history.spreadsheetCount, 2);
    assert.equal(history.imageCount, 0);
    assert.match(history.text, /日期,预算/);
    assert.match(history.text, /2026-08-08,120/);
    assert.match(history.text, /访客,42/);
    assert.match(history.text, /仅作为历史上下文/);
    assert.doesNotMatch(history.text, /ignored/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("rejects a history directory without supported files", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "promotion-history-"));
  try {
    await mkdir(join(cwd, "resources", "data"), { recursive: true });
    await writeFile(join(cwd, "resources", "data", "archive.bin"), "ignored", "utf8");
    await assert.rejects(
      loadPromotionHistory(cwd, "resources/data"),
      /contains no supported files/,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

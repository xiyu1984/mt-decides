import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { validateDate } from "./date.js";

const MAX_DECISION_BYTES = 64 * 1024;

function decisionPath(cwd: string, decisionsDirectory: string, date: string): string {
  return resolve(cwd, decisionsDirectory, `${validateDate(date)}.md`);
}

export async function readPromotionDecision(
  cwd: string,
  decisionsDirectory: string,
  date: string,
): Promise<string> {
  const path = decisionPath(cwd, decisionsDirectory, date);
  const contents = await readFile(path, "utf8").catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`promotion decision not found for ${date}: ${path}`);
    }
    throw error;
  });
  if (!contents.trim()) throw new Error(`promotion decision is empty: ${path}`);
  if (Buffer.byteLength(contents, "utf8") > MAX_DECISION_BYTES) {
    throw new Error(`promotion decision exceeds ${MAX_DECISION_BYTES} bytes: ${path}`);
  }
  return contents.trim();
}

export async function writePromotionDecision(
  cwd: string,
  decisionsDirectory: string,
  date: string,
  contents: string,
): Promise<string> {
  const normalized = contents.trim();
  if (!normalized) throw new Error("runtime LLM returned an empty promotion decision");
  if (Buffer.byteLength(normalized, "utf8") > MAX_DECISION_BYTES) {
    throw new Error(`runtime LLM promotion decision exceeds ${MAX_DECISION_BYTES} bytes`);
  }
  const path = decisionPath(cwd, decisionsDirectory, date);
  await mkdir(resolve(cwd, decisionsDirectory), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${normalized}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, path);
  } finally {
    await unlink(temporaryPath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  }
  return path;
}

import { readFileSync } from "node:fs";
import { join } from "node:path";

const MAX_PROMPT_FILE_BYTES = 64 * 1024;
export const WORKFLOW_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
const PATH_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export function readWorkflowPromptFile(
  cwd: string,
  workflow: string,
  ...segments: string[]
): string {
  if (!WORKFLOW_NAME_PATTERN.test(workflow)) {
    throw new Error(`invalid prompt workflow name: ${workflow}`);
  }
  if (
    segments.length === 0
    || segments.some((segment) => !PATH_SEGMENT_PATTERN.test(segment) || segment === "." || segment === "..")
  ) {
    throw new Error("prompt path must contain safe relative segments");
  }

  const path = join(cwd, "prompts", workflow, ...segments);
  const content = readFileSync(path, "utf8").trim();
  if (!content) throw new Error(`prompt file is empty: ${path}`);
  if (Buffer.byteLength(content, "utf8") > MAX_PROMPT_FILE_BYTES) {
    throw new Error(`prompt file exceeds ${MAX_PROMPT_FILE_BYTES} bytes: ${path}`);
  }
  return content;
}

export function readOptionalWorkflowPromptFile(
  cwd: string,
  workflow: string,
  ...segments: string[]
): string | undefined {
  try {
    return readWorkflowPromptFile(cwd, workflow, ...segments);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

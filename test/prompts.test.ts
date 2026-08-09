import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readOptionalWorkflowPromptFile, readWorkflowPromptFile } from "../src/prompts/loader.js";
import { renderPromptTemplate } from "../src/prompts/template.js";

test("loads bounded workflow prompts and renders strict placeholders", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "computer-use-prompts-"));
  try {
    await mkdir(join(cwd, "prompts", "orders"), { recursive: true });
    await writeFile(join(cwd, "prompts", "orders", "general.md"), "Task: {{TASK}}\n", "utf8");
    const template = readWorkflowPromptFile(cwd, "orders", "general.md");
    assert.equal(renderPromptTemplate(template, { TASK: "review" }), "Task: review");
    assert.equal(readOptionalWorkflowPromptFile(cwd, "orders", "missing.md"), undefined);
    assert.throws(() => readWorkflowPromptFile(cwd, "../orders", "general.md"), /invalid prompt workflow/);
    assert.throws(() => renderPromptTemplate(template, { OTHER: "review" }), /unknown prompt placeholder/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

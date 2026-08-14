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

test("browser workflow prompts separate semantic grounding from action delivery", () => {
  const cwd = process.cwd();
  for (const workflow of ["run", "promotion"]) {
    const prompt = readWorkflowPromptFile(cwd, workflow, "general.md");
    assert.match(prompt, /observe_ui.*mode="semantic"/s);
    assert.match(prompt, /search_ui/);
    assert.match(prompt, /inspect_ui/);
    assert.match(prompt, /act_ui/);
    assert.match(prompt, /Reuse every returned successor `stateId`/);
    assert.match(prompt, /Retry only once for a stale state/);
    assert.match(prompt, /semantic state to ground targets and verify outcomes/);
    assert.match(prompt, /trusted site policy for action delivery/);
    assert.match(prompt, /Do not recursively expand non-actionable ancestors/);
    assert.doesNotMatch(prompt, /`set_text`/);
  }

  const promotion = readWorkflowPromptFile(cwd, "promotion", "general.md");
  assert.match(promotion, /select "标准推"; enable any bidding mode.*set both dates.*finish the time editor.*final budget and bid inputs/s);
  assert.match(promotion, /Leave optional settings omitted by the decision unchanged/);
  assert.match(promotion, /Set final budget and bids together using the trusted site's delivery method/);
  assert.match(promotion, /If it is rejected, do not retry/);

  const meituan = readWorkflowPromptFile(cwd, "promotion", "sites", "ecom.meituan.com.md");
  assert.match(meituan, /For the 7×24 promotion-time grid/);
  assert.match(meituan, /10:00-20:00 means hour rows 10 through 19/);
  assert.match(meituan, /at most one correction/);
  assert.match(meituan, /use bounded `evaluate_browser` DOM delivery directly/);
  assert.match(meituan, /do not call `act_ui` or repeatedly search\/expand/);
  assert.match(meituan, /If `search_ui` reports `target-unavailable` once, do not call it again on that root/);
  assert.match(meituan, /Do not use `expand_ui` solely to locate a DOM-first business control/);
  assert.match(meituan, /Unmentioned days are unselected/);
  assert.doesNotMatch(meituan, /\bAX\b/);
});

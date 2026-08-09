import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  loadWorkflowAssistant,
  updateWorkflowAssistant,
  type AssistantDefinition,
} from "../src/assistant/workflow-assistant.js";

const definition: AssistantDefinition = {
  workflow: "orders",
  scope: "https://example.com",
  fileSlug: "example.com",
  categories: ["navigation", "outputs"],
};

test("adds, verifies, and quarantines workflow assistant clues", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "computer-use-assistant-"));
  try {
    const first = await updateWorkflowAssistant(cwd, definition, [{
      topic: "navigation.orders",
      category: "navigation",
      text: "The orders page is opened with the visible \"Orders\" navigation item.",
    }]);
    assert.equal(first.addedCount, 1);
    assert.equal(first.conflictCount, 0);

    const verification = await updateWorkflowAssistant(cwd, definition, [], ["navigation.orders"]);
    assert.equal(verification.verifiedCount, 1);
    const loaded = await loadWorkflowAssistant(cwd, definition);
    assert.equal(loaded.clues[0]?.successCount, 2);

    const conflict = await updateWorkflowAssistant(cwd, definition, [{
      topic: "navigation.orders",
      category: "navigation",
      text: "The orders page is opened with the visible \"Purchases\" navigation item.",
    }]);
    assert.equal(conflict.conflictCount, 1);
    assert.ok(conflict.conflictPath);
    const unchanged = await loadWorkflowAssistant(cwd, definition);
    assert.match(unchanged.clues[0]?.text ?? "", /"Orders"/);
    assert.doesNotMatch(unchanged.clues[0]?.text ?? "", /"Purchases"/);
    const conflictFile = JSON.parse(await readFile(join(cwd, conflict.conflictPath!), "utf8")) as {
      conflicts: unknown[];
    };
    assert.equal(conflictFile.conflicts.length, 1);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("rejects sensitive assistant content", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "computer-use-assistant-"));
  try {
    await assert.rejects(
      updateWorkflowAssistant(cwd, definition, [{
        topic: "outputs.secret",
        category: "outputs",
        text: "Copy the session token from localStorage.",
      }]),
      /cannot contain secrets/,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

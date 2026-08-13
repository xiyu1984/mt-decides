import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createAssistantClueTool,
  formatAssistantClues,
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

test("accepts an empty clue proposal when nothing reusable was learned", async () => {
  const assistantClueTool = createAssistantClueTool(definition, []);
  const context = undefined as never;
  await assistantClueTool.tool.execute("empty", { clues: [] }, undefined, undefined, context);
  assert.deepEqual(assistantClueTool.getProposals(), []);
  assert.deepEqual(assistantClueTool.getVerificationTopics(), []);
  await assert.rejects(
    assistantClueTool.tool.execute("second", { clues: [] }, undefined, undefined, context),
    /already been proposed/,
  );
});

test("a rejected clue proposal does not consume the run attempt", async () => {
  const assistantClueTool = createAssistantClueTool(definition, []);
  const context = undefined as never;
  await assert.rejects(
    assistantClueTool.tool.execute("unsafe", {
      clues: [{
        topic: "outputs.secret",
        category: "outputs",
        text: "Copy the session token from localStorage.",
      }],
    }, undefined, undefined, context),
    /cannot contain secrets/,
  );
  await assistantClueTool.tool.execute("retry", {
    clues: [{
      topic: "navigation.orders",
      category: "navigation",
      text: "The visible \"Orders\" navigation item opens the orders page.",
    }],
  }, undefined, undefined, context);
  assert.equal(assistantClueTool.getProposals().length, 1);
});

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

test("a locked assistant file stays unchanged and quarantines runtime findings", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "computer-use-assistant-"));
  try {
    await updateWorkflowAssistant(cwd, definition, [{
      topic: "navigation.orders",
      category: "navigation",
      text: "The orders page is opened with the visible \"Orders\" navigation item.",
    }]);
    const assistantPath = join(cwd, "assistant", "orders", "example.com.json");
    const stored = JSON.parse(await readFile(assistantPath, "utf8")) as Record<string, unknown>;
    stored["auto-update"] = "false";
    const lockedContents = `${JSON.stringify(stored, null, 2)}\n`;
    await writeFile(assistantPath, lockedContents);

    const locked = await loadWorkflowAssistant(cwd, definition);
    assert.equal(locked["auto-update"], "false");
    assert.match(formatAssistantClues(locked.clues, locked["auto-update"]), /assistant file auto-update false; locked/);

    const verification = await updateWorkflowAssistant(cwd, definition, [], ["navigation.orders"]);
    assert.equal(verification.locked, true);
    assert.equal(verification.verifiedCount, 0);
    assert.equal(verification.conflictCount, 1);
    const verificationConflict = JSON.parse(await readFile(join(cwd, verification.conflictPath!), "utf8")) as {
      conflicts: Array<{ reason: string }>;
    };
    assert.equal(verificationConflict.conflicts[0]?.reason, "locked-file-verification");
    assert.equal(await readFile(assistantPath, "utf8"), lockedContents);

    const assistantClueTool = createAssistantClueTool(
      definition,
      locked.clues,
      () => true,
      locked["auto-update"],
    );
    const context = undefined as never;
    await assistantClueTool.tool.execute("locked-findings", {
      verifiedTopics: ["navigation.orders"],
      clues: [{
        topic: "navigation.orders",
        category: "navigation",
        text: "The orders page is now opened with the visible \"Purchases\" navigation item.",
      }, {
        topic: "outputs.order-count",
        category: "outputs",
        text: "The visible \"Order count\" value appears in the summary panel.",
      }],
    }, undefined, undefined, context);
    assert.equal(assistantClueTool.getProposals().length, 2);

    const findings = await updateWorkflowAssistant(
      cwd,
      definition,
      assistantClueTool.getProposals(),
      assistantClueTool.getVerificationTopics(),
    );
    assert.equal(findings.locked, true);
    assert.equal(findings.addedCount, 0);
    assert.equal(findings.verifiedCount, 0);
    assert.equal(findings.conflictCount, 2);
    const findingConflict = JSON.parse(await readFile(join(cwd, findings.conflictPath!), "utf8")) as {
      conflicts: Array<{ reason: string; proposedClues: Array<{ text: string }> }>;
    };
    assert.ok(findingConflict.conflicts.every(({ reason }) => reason === "locked-file-finding"));
    assert.ok(findingConflict.conflicts.some(({ proposedClues }) => (
      proposedClues.some(({ text }) => text.includes('"Purchases"'))
    )));
    assert.equal(await readFile(assistantPath, "utf8"), lockedContents);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("rejects unsupported assistant file auto-update values", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "computer-use-assistant-"));
  try {
    await updateWorkflowAssistant(cwd, definition, [{
      topic: "navigation.orders",
      category: "navigation",
      text: "The orders page is opened with the visible \"Orders\" navigation item.",
    }]);
    const assistantPath = join(cwd, "assistant", "orders", "example.com.json");
    const stored = JSON.parse(await readFile(assistantPath, "utf8")) as Record<string, unknown>;
    stored["auto-update"] = false;
    await writeFile(assistantPath, `${JSON.stringify(stored, null, 2)}\n`);
    await assert.rejects(loadWorkflowAssistant(cwd, definition), /auto-update must be \"false\"/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

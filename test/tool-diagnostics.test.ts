import assert from "node:assert/strict";
import test from "node:test";

import { formatToolCompletion, formatToolStart } from "../src/computer-use/tool-diagnostics.js";

test("formats safe tool intent without argument values", () => {
  const line = formatToolStart("act_ui", {
    stateId: "secret-state",
    actions: [
      { action: "setText", ref: "@e1", text: "sensitive value" },
      { action: "press", ref: "@e2" },
    ],
  });

  assert.equal(line, "[tool] act_ui actions=2 types=setText,press");
  assert.doesNotMatch(line, /sensitive|secret|@e/);
});

test("formats safe discovery and evaluation intent", () => {
  assert.equal(formatToolStart("observe_ui", { mode: "semantic", root: "@r1" }), "[tool] observe_ui mode=semantic");
  assert.equal(formatToolStart("search_ui", { text: "private", role: "button" }), "[tool] search_ui filters=text,role");
  assert.equal(formatToolStart("evaluate_browser", { expression: "private expression" }), "[tool] evaluate_browser expressionChars=18");
});

test("formats bounded tool diagnostics without result content", () => {
  const line = formatToolCompletion("act_ui", {
    content: [{ type: "text", text: "sensitive page value" }],
    details: {
      execution: { outcome: "worked", actionCount: 3 },
      changes: [{}, {}],
    },
  }, false, 123.6);

  assert.equal(line, "[tool-result] act_ui ok 124ms outcome=worked actions=3 changes=2");
  assert.doesNotMatch(line, /sensitive/);
});

test("formats minimal error diagnostics", () => {
  assert.equal(formatToolCompletion("evaluate_browser", undefined, true, -1), "[tool-result] evaluate_browser error 0ms reason=unknown");
});

test("does not describe a checked non-action as successful", () => {
  assert.equal(formatToolCompletion("act_ui", {
    details: { execution: { outcome: "didnt", actionCount: 1 } },
  }, false, 25), "[tool-result] act_ui not-applied 25ms outcome=didnt actions=1");
});

test("classifies errors without logging their content", () => {
  const line = formatToolCompletion("act_ui", {
    content: [{ type: "text", text: "Outline ref is stale; sensitive page value" }],
  }, true, 10);

  assert.equal(line, "[tool-result] act_ui error 10ms reason=stale-state");
  assert.doesNotMatch(line, /sensitive|page value/);
});

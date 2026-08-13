import assert from "node:assert/strict";
import test from "node:test";

import { assertPromotionRunReady } from "../src/promotion/review-readiness.js";

const completeRun = {
  assistantError: undefined,
  assistantStopReason: "stop",
  assistantRawStopReason: undefined,
  assistantProvider: "minimax",
  assistantModel: "MiniMax-M2.7-highspeed",
  assistantApi: "anthropic-messages",
  assistantDiagnostics: [],
  assistantText: "All settings are complete; 立即创建 was not clicked.",
  stateChangingToolCount: 3,
  reviewMarkedReady: true,
};

test("accepts a verified promotion run with browser actions and a final summary", () => {
  assert.doesNotThrow(() => assertPromotionRunReady(completeRun));
});

test("rejects a provider error instead of entering review", () => {
  assert.throws(
    () => assertPromotionRunReady({
      ...completeRun,
      assistantError: "401 invalid api key",
      assistantStopReason: "error",
      assistantText: "",
      stateChangingToolCount: 0,
      reviewMarkedReady: false,
    }),
    /LLM request failed \(provider=minimax, model=MiniMax-M2\.7-highspeed, api=anthropic-messages, stopReason=error\): 401 invalid api key/,
  );
});

test("includes raw provider and diagnostic details when no error message is available", () => {
  assert.throws(
    () => assertPromotionRunReady({
      ...completeRun,
      assistantStopReason: "error",
      assistantRawStopReason: "bad_request",
      assistantDiagnostics: ["provider-stream code=400 tool schema rejected"],
    }),
    /rawStopReason=bad_request.*diagnostics: provider-stream code=400 tool schema rejected/,
  );
});

test("rejects no-op and unverified promotion runs", () => {
  assert.throws(
    () => assertPromotionRunReady({
      ...completeRun,
      stateChangingToolCount: 0,
      reviewMarkedReady: false,
    }),
    /performed no browser actions/,
  );
  assert.throws(
    () => assertPromotionRunReady({ ...completeRun, reviewMarkedReady: false }),
    /did not verify the form as ready for review/,
  );
});

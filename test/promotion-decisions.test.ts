import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { formatLocalDate, tomorrowLocalDate, validateDate } from "../src/promotion/date.js";
import { readPromotionDecision, writePromotionDecision } from "../src/promotion/decisions.js";

test("uses local calendar dates across month and year boundaries", () => {
  assert.equal(formatLocalDate(new Date(2026, 7, 9, 23, 30)), "2026-08-09");
  assert.equal(tomorrowLocalDate(new Date(2026, 11, 31, 23, 30)), "2027-01-01");
  assert.equal(validateDate("2028-02-29"), "2028-02-29");
  assert.throws(() => validateDate("2027-02-29"), /invalid decision date/);
  assert.throws(() => validateDate("tomorrow"), /YYYY-MM-DD/);
});

test("atomically writes and reads a dated promotion decision", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "promotion-decisions-"));
  try {
    const path = await writePromotionDecision(cwd, "decisions", "2026-08-10", "# 推广方案\n\n- 类型：标准推");
    assert.equal(path, join(cwd, "decisions", "2026-08-10.md"));
    assert.equal(
      await readPromotionDecision(cwd, "decisions", "2026-08-10"),
      "# 推广方案\n\n- 类型：标准推",
    );
    await assert.rejects(
      readPromotionDecision(cwd, "decisions", "2026-08-11"),
      /promotion decision not found/,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

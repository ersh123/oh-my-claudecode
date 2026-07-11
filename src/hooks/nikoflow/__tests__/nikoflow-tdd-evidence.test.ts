/**
 * lintTddEvidence — pure shape/ordering lint of model-written TDD evidence.
 * Anti-sloppiness, not anti-forgery: the hook never executes commands; the
 * reviewer cross-checks honesty against the diff.
 */
import { describe, it, expect } from "vitest";
import { lintTddEvidence, TDD_SHA_PATTERN } from "../tickets.js";

const red = {
  command: "npx vitest run x.test.ts",
  exit_code: 1,
  expected_failure: "parser lacks empty-input branch",
  head_sha: "abc1234",
  recorded_at: "2026-07-10T10:00:00Z",
};
const green = {
  command: "npx vitest run x.test.ts",
  exit_code: 0,
  head_sha: "abc1234",
  recorded_at: "2026-07-10T10:05:00Z",
};

describe("lintTddEvidence", () => {
  it("accepts a valid red+green pair", () => {
    expect(lintTddEvidence({ red, green })).toEqual([]);
  });

  it("rejects missing / undefined / non-object with an error naming evidence.tdd", () => {
    for (const raw of [undefined, null, "tdd", 42]) {
      const errs = lintTddEvidence(raw);
      expect(errs).toHaveLength(1);
      expect(errs[0]).toContain("evidence.tdd");
    }
  });

  it("rejects a red run that exited 0", () => {
    const errs = lintTddEvidence({ red: { ...red, exit_code: 0 }, green });
    expect(errs.join("; ")).toContain("exited 0");
  });

  it("rejects a green run with a non-zero exit code", () => {
    const errs = lintTddEvidence({ red, green: { ...green, exit_code: 2 } });
    expect(errs.join("; ")).toContain("green.exit_code");
  });

  it("rejects empty command and missing expected_failure", () => {
    const errs = lintTddEvidence({
      red: { ...red, command: "", expected_failure: undefined },
      green,
    });
    expect(errs.join("; ")).toContain("red.command");
    expect(errs.join("; ")).toContain("expected_failure");
  });

  it("rejects head_sha grammar violations", () => {
    for (const sha of ["HEAD", "g1234567", "abc12", 7]) {
      const errs = lintTddEvidence({ red: { ...red, head_sha: sha }, green });
      expect(errs.join("; ")).toContain("head_sha");
    }
    expect(TDD_SHA_PATTERN.test("ABCdef1234")).toBe(true);
  });

  it("rejects missing / unparseable recorded_at", () => {
    for (const ts of [undefined, "not-a-date"]) {
      const errs = lintTddEvidence({ red: { ...red, recorded_at: ts }, green });
      expect(errs.join("; ")).toContain("recorded_at");
    }
  });

  it("enforces red-before-green ordering; equal timestamps are valid", () => {
    const errs = lintTddEvidence({
      red: { ...red, recorded_at: "2026-07-10T11:00:00Z" },
      green, // 10:05, before red
    });
    expect(errs.join("; ")).toContain("red must be recorded before green");
    expect(
      lintTddEvidence({ red: { ...red, recorded_at: green.recorded_at }, green }),
    ).toEqual([]);
  });

  it("rejects red-only partial evidence (complete obligation at gate time)", () => {
    const errs = lintTddEvidence({ red });
    expect(errs.join("; ")).toContain("green run is missing");
  });

  it("accepts a waiver with a reason, even with garbage red alongside", () => {
    expect(lintTddEvidence({ waived: { reason: "docs only" } })).toEqual([]);
    expect(
      lintTddEvidence({ waived: { reason: "docs only" }, red: { junk: true } }),
    ).toEqual([]);
  });

  it("rejects an empty or malformed waiver", () => {
    for (const waived of [{ reason: "" }, {}, true]) {
      const errs = lintTddEvidence({ waived });
      expect(errs.join("; ")).toContain("waived.reason");
    }
  });

  it("tolerates unknown extra fields (forward compat)", () => {
    expect(
      lintTddEvidence({
        red: { ...red, duration_ms: 1200 },
        green: { ...green, runner: "vitest" },
        notes: "extra",
      }),
    ).toEqual([]);
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import { createTextDiff } from "../src/text-diff.js";

test("reports added and removed lines with their original positions", () => {
  const result = createTextDiff("alpha\nbeta\ngamma", "alpha\ndelta\ngamma");

  assert.equal(result.added, 1);
  assert.equal(result.removed, 1);
  assert.equal(result.identical, false);
  assert.deepEqual(
    result.lines.filter((line) => line.type === "removed" || line.type === "added"),
    [
      { type: "removed", content: "beta", oldLine: 2, newLine: null },
      { type: "added", content: "delta", oldLine: null, newLine: 2 },
    ],
  );
});

test("collapses long unchanged sections while preserving nearby context", () => {
  const lines = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`);
  const changed = [...lines];
  changed[6] = "changed";
  const result = createTextDiff(lines.join("\n"), changed.join("\n"), 800, 2);

  assert.equal(result.lines.filter((line) => line.type === "skipped").length, 1);
  assert.ok(result.lines.some((line) => line.content === "line 6"));
  assert.ok(result.lines.some((line) => line.content === "line 8"));
});

test("marks bounded comparisons and rejects invalid limits", () => {
  const result = createTextDiff("a\nb\nc", "a\nb\nd", 2);

  assert.equal(result.truncated, true);
  assert.throws(() => createTextDiff("a", "b", 0), /positive integer/);
});

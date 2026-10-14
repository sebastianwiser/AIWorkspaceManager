export type DiffLineType = "context" | "added" | "removed" | "skipped";

export interface DiffLine {
  type: DiffLineType;
  content: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface TextDiffResult {
  lines: DiffLine[];
  added: number;
  removed: number;
  identical: boolean;
  truncated: boolean;
}

const DEFAULT_MAX_LINES = 800;
const DEFAULT_CONTEXT_LINES = 3;

/**
 * Produce a bounded, line-oriented diff suitable for an inert local preview.
 * The line cap keeps the LCS matrix predictable for unusually large files.
 */
export function createTextDiff(
  oldText: string,
  newText: string,
  maxLines = DEFAULT_MAX_LINES,
  contextLines = DEFAULT_CONTEXT_LINES,
): TextDiffResult {
  if (!Number.isSafeInteger(maxLines) || maxLines <= 0) {
    throw new Error("The diff line limit must be a positive integer.");
  }
  if (!Number.isSafeInteger(contextLines) || contextLines < 0) {
    throw new Error("The diff context must be a non-negative integer.");
  }

  const allOldLines = splitLines(oldText);
  const allNewLines = splitLines(newText);
  const oldLines = allOldLines.slice(0, maxLines);
  const newLines = allNewLines.slice(0, maxLines);
  const matrix = buildLcsMatrix(oldLines, newLines);
  const lines = buildDiffLines(oldLines, newLines, matrix);
  const added = lines.filter((line) => line.type === "added").length;
  const removed = lines.filter((line) => line.type === "removed").length;

  return {
    lines: collapseUnchangedLines(lines, contextLines),
    added,
    removed,
    identical:
      allOldLines.length === allNewLines.length &&
      allOldLines.every((line, index) => line === allNewLines[index]),
    truncated: allOldLines.length > maxLines || allNewLines.length > maxLines,
  };
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  return text.replace(/\r\n?/g, "\n").split("\n");
}

function buildLcsMatrix(oldLines: readonly string[], newLines: readonly string[]): Uint16Array[] {
  const matrix = Array.from(
    { length: oldLines.length + 1 },
    () => new Uint16Array(newLines.length + 1),
  );

  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      matrix[oldIndex][newIndex] =
        oldLines[oldIndex] === newLines[newIndex]
          ? matrix[oldIndex + 1][newIndex + 1] + 1
          : Math.max(matrix[oldIndex + 1][newIndex], matrix[oldIndex][newIndex + 1]);
    }
  }

  return matrix;
}

function buildDiffLines(
  oldLines: readonly string[],
  newLines: readonly string[],
  matrix: readonly Uint16Array[],
): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      lines.push({
        type: "context",
        content: oldLines[oldIndex],
        oldLine: oldIndex + 1,
        newLine: newIndex + 1,
      });
      oldIndex += 1;
      newIndex += 1;
    } else if (matrix[oldIndex + 1][newIndex] >= matrix[oldIndex][newIndex + 1]) {
      lines.push({
        type: "removed",
        content: oldLines[oldIndex],
        oldLine: oldIndex + 1,
        newLine: null,
      });
      oldIndex += 1;
    } else {
      lines.push({
        type: "added",
        content: newLines[newIndex],
        oldLine: null,
        newLine: newIndex + 1,
      });
      newIndex += 1;
    }
  }

  while (oldIndex < oldLines.length) {
    lines.push({
      type: "removed",
      content: oldLines[oldIndex],
      oldLine: oldIndex + 1,
      newLine: null,
    });
    oldIndex += 1;
  }
  while (newIndex < newLines.length) {
    lines.push({
      type: "added",
      content: newLines[newIndex],
      oldLine: null,
      newLine: newIndex + 1,
    });
    newIndex += 1;
  }

  return lines;
}

function collapseUnchangedLines(lines: readonly DiffLine[], contextLines: number): DiffLine[] {
  const result: DiffLine[] = [];
  let index = 0;

  while (index < lines.length) {
    if (lines[index].type !== "context") {
      result.push(lines[index]);
      index += 1;
      continue;
    }

    let end = index;
    while (end < lines.length && lines[end].type === "context") end += 1;
    const run = lines.slice(index, end);
    const keep = contextLines * 2;
    if (run.length <= keep + 1) {
      result.push(...run);
    } else {
      result.push(...run.slice(0, contextLines));
      result.push({
        type: "skipped",
        content: `${run.length - keep} unchanged lines`,
        oldLine: null,
        newLine: null,
      });
      result.push(...run.slice(run.length - contextLines));
    }
    index = end;
  }

  return result;
}

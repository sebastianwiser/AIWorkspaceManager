import { createHash } from "node:crypto";
import { readRegularFileBounded } from "../safe-file.js";
import type { AuditExcerptResult, AuditFileRecord, AuditFinding } from "../types.js";

const MAX_EXCERPT_FILE_BYTES = 1024 * 1024;
const MAX_LINE_CHARACTERS = 4000;

/** Reveal a small, explicitly requested excerpt from an audited instruction file. */
export async function readAuditExcerpt(
  finding: AuditFinding,
  files: readonly AuditFileRecord[],
): Promise<AuditExcerptResult> {
  if (
    finding.family !== "instructions" ||
    (finding.itemKind !== "skill" && finding.itemKind !== "plugin") ||
    !Number.isSafeInteger(finding.line) ||
    (finding.line ?? 0) < 1 ||
    !/\.(?:md|txt)$/i.test(finding.sourceFile)
  ) {
    return { ok: false, error: "This warning has no inspectable instruction line." };
  }

  const file = files.find(
    (item) =>
      item.application === finding.application &&
      item.itemKind === finding.itemKind &&
      finding.itemIds.includes(item.itemId) &&
      item.sourceFile === finding.sourceFile,
  );
  if (!file || file.bytes > MAX_EXCERPT_FILE_BYTES) {
    return { ok: false, error: "The source was not fully inspected. Rescan before opening it." };
  }

  try {
    const data = await readRegularFileBounded(file.sourceFile, file.bytes);
    if (createHash("sha256").update(data).digest("hex") !== file.sha256) {
      return {
        ok: false,
        error: "The file changed since this audit. Rescan before inspecting it.",
      };
    }
    const lines = data.toString("utf8").split(/\r?\n/);
    const highlightedLine = finding.line as number;
    if (highlightedLine > lines.length) {
      return { ok: false, error: "The cited line is no longer available. Rescan the audit." };
    }
    const start = Math.max(1, highlightedLine - 2);
    const end = Math.min(lines.length, highlightedLine + 2);
    return {
      ok: true,
      sourceFile: finding.sourceFile,
      highlightedLine,
      lines: lines.slice(start - 1, end).map((text, index) => ({
        number: start + index,
        text: text.slice(0, MAX_LINE_CHARACTERS),
        truncated: text.length > MAX_LINE_CHARACTERS,
      })),
    };
  } catch {
    return { ok: false, error: "The file could not be read safely. Rescan before inspecting it." };
  }
}

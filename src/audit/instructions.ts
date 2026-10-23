import type { InstructionRiskSignal } from "../types.js";

export interface InstructionRiskMatch {
  signal: InstructionRiskSignal;
  line: number;
}

const AUTHORITY_CLAIM =
  /\b(?:system|developer|administrator|admin|policy)\s*(?:message|instruction|directive|override)?\s*[:-]/i;
const OVERRIDE =
  /\b(?:ignore|disregard|override|supersede)\b.{0,100}\b(?:previous|prior|other|user|system|developer)\b.{0,60}\b(?:instructions?|rules?|polic(?:y|ies)|requests?)\b/i;
const CONCEAL =
  /\b(?:do not|don't|never)\s+(?:tell|inform|notify)\s+(?:the\s+)?user\b|\b(?:silently|without (?:user\s+)?(?:approval|permission|confirmation))\b/i;
const ACTION =
  /\b(?:send|upload|post|email|forward|read|open|execute|run|delete|modify|collect|extract|copy)\b/i;
const PRIVATE_DATA =
  /(?:\.env\b|\b(?:environment variables?|api[_ -]?keys?|secrets?|credentials?|tokens?|private (?:files?|data)|conversation history|user (?:files?|data)|ssh keys?|configuration files?)\b)/i;
const EGRESS = /\b(?:send|upload|post|email|forward|transmit|share|exfiltrate)\b/i;
const EXTERNAL =
  /https?:\/\/|\b(?:webhook|external|third[- ]party|remote server)\b|@[a-z0-9.-]+\.[a-z]{2,}/i;
const EGRESS_PROHIBITION =
  /\b(?:never|do not|don't|avoid|should not)\s+(?:send|upload|post|email|forward|transmit|share)\b/i;

/** Heuristic clues, not a verdict. Never return source text or matched values. */
export function analyzeInstructionText(contents: string): InstructionRiskMatch[] {
  const lines = contents.split(/\r?\n/);
  const matches: InstructionRiskMatch[] = [];
  const seen = new Set<InstructionRiskSignal>();
  const add = (signal: InstructionRiskSignal, line: number): void => {
    if (seen.has(signal)) return;
    matches.push({ signal, line });
    seen.add(signal);
  };
  for (let index = 0; index < lines.length && seen.size < 3; index += 1) {
    const context = lines.slice(Math.max(0, index - 2), index + 1).join(" ");
    const line = index + 1;
    if (AUTHORITY_CLAIM.test(context) && OVERRIDE.test(context)) {
      add("instruction-authority-override", line);
    }
    if (CONCEAL.test(context) && ACTION.test(context)) {
      add("instruction-concealed-action", line);
    }
    if (
      PRIVATE_DATA.test(context) &&
      EGRESS.test(context) &&
      EXTERNAL.test(context) &&
      !EGRESS_PROHIBITION.test(context)
    ) {
      add("instruction-private-data-egress", line);
    }
  }
  return matches;
}

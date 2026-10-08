import { open } from "node:fs/promises";
import type { SkillContent } from "./types.js";

// Keeping the preview bounded prevents an unexpectedly large local file from
// making the desktop window unresponsive. Normal SKILL.md files are far smaller.
export const DEFAULT_CONTENT_LIMIT_BYTES = 512 * 1024;

export async function readSkillContent(
  instructionFile: string,
  limitBytes = DEFAULT_CONTENT_LIMIT_BYTES,
): Promise<SkillContent> {
  if (!Number.isSafeInteger(limitBytes) || limitBytes <= 0) {
    throw new Error("The content limit must be a positive integer.");
  }

  const file = await open(instructionFile, "r");

  try {
    const fileStats = await file.stat();
    const bytesToRead = Math.min(fileStats.size, limitBytes);

    if (bytesToRead === 0) {
      return { content: "", truncated: false };
    }

    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await file.read(buffer, 0, bytesToRead, 0);

    return {
      content: buffer.subarray(0, bytesRead).toString("utf8"),
      truncated: fileStats.size > bytesRead,
    };
  } finally {
    await file.close();
  }
}

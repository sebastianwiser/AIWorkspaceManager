import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, lstat, type FileHandle } from "node:fs/promises";

/** Open a regular file without following a final-component symbolic link. */
export async function openRegularFileNoFollow(filePath: string): Promise<FileHandle> {
  if (typeof constants.O_NOFOLLOW !== "number") {
    throw new Error("Safe no-follow file reads are unavailable on this platform.");
  }
  const before = await lstat(filePath);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error("The requested file is not a regular file.");
  }
  const file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await file.stat()).isFile()) throw new Error("The requested file is not a regular file.");
    return file;
  } catch (error) {
    await file.close();
    throw error;
  }
}

/** Read only the requested prefix, regardless of the file's total size. */
export async function readRegularFilePrefix(filePath: string, maxBytes: number): Promise<Buffer> {
  const file = await openRegularFileNoFollow(filePath);
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await file.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

/** Read an entire regular file only when it fits the caller's size limit. */
export async function readRegularFileBounded(filePath: string, maxBytes: number): Promise<Buffer> {
  const file = await openRegularFileNoFollow(filePath);
  try {
    const stats = await file.stat();
    if (stats.size > maxBytes) throw new Error("The file exceeds its read safety limit.");
    const buffer = Buffer.alloc(stats.size);
    let position = 0;
    while (position < stats.size) {
      const { bytesRead } = await file.read(buffer, position, stats.size - position, position);
      if (bytesRead === 0) break;
      position += bytesRead;
    }
    const after = await file.stat();
    if (position !== stats.size || after.size !== stats.size || after.mtimeMs !== stats.mtimeMs) {
      throw new Error("The file changed during reading.");
    }
    return buffer;
  } finally {
    await file.close();
  }
}

/** Hash with fixed memory use and a strict total-size ceiling. */
export async function hashRegularFile(filePath: string, maxBytes: number): Promise<string> {
  const file = await openRegularFileNoFollow(filePath);
  try {
    const stats = await file.stat();
    if (stats.size > maxBytes) throw new Error("The file exceeds the fingerprint safety limit.");
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(64 * 1024);
    let position = 0;
    while (position < stats.size) {
      const { bytesRead } = await file.read(
        buffer,
        0,
        Math.min(buffer.length, stats.size - position),
        position,
      );
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await file.stat();
    if (position !== stats.size || after.size !== stats.size || after.mtimeMs !== stats.mtimeMs) {
      throw new Error("The file changed during fingerprinting.");
    }
    return hash.digest("hex");
  } finally {
    await file.close();
  }
}

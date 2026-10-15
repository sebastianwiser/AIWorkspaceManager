import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { getScanContext } from "../applications.js";
import {
  compareInventorySnapshots,
  createInventorySnapshot,
  isInventoryScanComplete,
  readInventorySnapshot,
  writeInventorySnapshot,
  type InventorySnapshot,
} from "../changes.js";
import { scanLocalInventory } from "../inventory-scan.js";
import { readSkillContent, type ExpectedFileIdentity } from "../skill-content.js";
import type { DesktopScanResult, InventoryChanges, SkillContentResult } from "../types.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const { app, BrowserWindow, ipcMain } = electron;
const SCAN_CHANNEL = "inventory:scan";
const READ_CONTENT_CHANNEL = "inventory:read-skill-content";
const RESET_BASELINE_CHANNEL = "inventory:reset-baseline";

let allowedInstructionFiles = new Map<string, ExpectedFileIdentity>();
let latestSnapshot: InventorySnapshot | null = null;

function registerHandlers(): void {
  ipcMain.handle(SCAN_CHANNEL, async (): Promise<DesktopScanResult> => {
    const context = await getScanContext();
    const result = await scanLocalInventory({
      applications: context.applications,
      projects: context.projects,
      initialDiagnostics: context.diagnostics,
    });
    const scannedAt = new Date().toISOString();
    const snapshot = await createInventorySnapshot(result.skills, scannedAt);
    for (const entry of snapshot.skills) {
      if (entry.fingerprint === null) {
        result.diagnostics.push({
          application: entry.skill.application,
          location: entry.skill.instructionFile,
          severity: "warning",
          code: "READ_FAILED",
          message: "A skill changed or could not be fingerprinted while the baseline was prepared.",
        });
      }
    }
    const baselinePath = getBaselinePath();
    const previousSnapshot = await readInventorySnapshot(baselinePath);
    const complete = isInventoryScanComplete(
      previousSnapshot,
      context.applications,
      result.diagnostics,
    );
    const changes = complete
      ? compareInventorySnapshots(snapshot, previousSnapshot)
      : {
          baselineCreated: false,
          baselinePreserved: true,
          baselineScannedAt: previousSnapshot?.scannedAt ?? null,
          comparedAt: scannedAt,
          items: [],
        };
    if (complete) {
      await writeInventorySnapshot(baselinePath, snapshot);
    } else {
      result.diagnostics.push({
        application: "chatgpt",
        location: baselinePath,
        severity: "warning",
        code: "BASELINE_PRESERVED",
        message:
          "The scan was incomplete. The previous baseline was kept; removals were not assessed.",
      });
    }

    latestSnapshot = complete ? snapshot : null;
    const fileIdentities = await Promise.all(
      result.skills.map(async (skill) => {
        try {
          const stats = await fs.lstat(skill.instructionFile);
          return stats.isFile() && !stats.isSymbolicLink()
            ? ([skill.instructionFile, { dev: stats.dev, ino: stats.ino }] as const)
            : null;
        } catch {
          return null;
        }
      }),
    );
    allowedInstructionFiles = new Map(fileIdentities.filter((entry) => entry !== null));

    return {
      ...result,
      scannedAt,
      changes,
    };
  });

  ipcMain.handle(RESET_BASELINE_CHANNEL, async (): Promise<InventoryChanges> => {
    if (!latestSnapshot) {
      throw new Error("Complete a full inventory scan before resetting its baseline.");
    }

    await writeInventorySnapshot(getBaselinePath(), latestSnapshot);
    return compareInventorySnapshots(latestSnapshot, null);
  });

  ipcMain.handle(
    READ_CONTENT_CHANNEL,
    async (_event, instructionFile: unknown): Promise<SkillContentResult> => {
      // The renderer may only read an exact SKILL.md path produced by the most
      // recent scan. It cannot use this channel as a general file reader.
      const identity =
        typeof instructionFile === "string" ? allowedInstructionFiles.get(instructionFile) : null;
      if (typeof instructionFile !== "string" || !identity) {
        return { ok: false, error: "That skill is not part of the current inventory." };
      }

      try {
        const result = await readSkillContent(instructionFile, undefined, identity);
        return { ok: true, ...result };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "The skill file could not be read.",
        };
      }
    },
  );
}

function getBaselinePath(): string {
  return path.join(app.getPath("userData"), "inventory-baseline.json");
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 940,
    minHeight: 640,
    backgroundColor: "#f4f2ed",
    title: "SkillManagerOS",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(currentDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // The inventory has no web navigation. Denying it keeps discovered text or
  // future links from turning the desktop window into a general browser.
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());

  void window.loadFile(path.join(currentDirectory, "renderer", "index.html"));
  return window;
}

app.setName("SkillManagerOS");

void app.whenReady().then(() => {
  registerHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

import path from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { getScanApplications } from "../applications.js";
import {
  compareInventorySnapshots,
  createInventorySnapshot,
  readInventorySnapshot,
  writeInventorySnapshot,
  type InventorySnapshot,
} from "../changes.js";
import { scanApplications } from "../scanner.js";
import { readSkillContent } from "../skill-content.js";
import type { DesktopScanResult, InventoryChanges, SkillContentResult } from "../types.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const { app, BrowserWindow, ipcMain } = electron;
const SCAN_CHANNEL = "inventory:scan";
const READ_CONTENT_CHANNEL = "inventory:read-skill-content";
const RESET_BASELINE_CHANNEL = "inventory:reset-baseline";

let allowedInstructionFiles = new Set<string>();
let latestSnapshot: InventorySnapshot | null = null;

function registerHandlers(): void {
  ipcMain.handle(SCAN_CHANNEL, async (): Promise<DesktopScanResult> => {
    const result = await scanApplications({ applications: await getScanApplications() });
    const scannedAt = new Date().toISOString();
    const snapshot = await createInventorySnapshot(result.skills, scannedAt);
    const baselinePath = getBaselinePath();
    const previousSnapshot = await readInventorySnapshot(baselinePath);
    const changes = compareInventorySnapshots(snapshot, previousSnapshot);
    await writeInventorySnapshot(baselinePath, snapshot);

    latestSnapshot = snapshot;
    allowedInstructionFiles = new Set(result.skills.map((skill) => skill.instructionFile));

    return {
      ...result,
      scannedAt,
      changes,
    };
  });

  ipcMain.handle(RESET_BASELINE_CHANNEL, async (): Promise<InventoryChanges> => {
    if (!latestSnapshot) {
      throw new Error("Scan the inventory before resetting its baseline.");
    }

    await writeInventorySnapshot(getBaselinePath(), latestSnapshot);
    return compareInventorySnapshots(latestSnapshot, null);
  });

  ipcMain.handle(
    READ_CONTENT_CHANNEL,
    async (_event, instructionFile: unknown): Promise<SkillContentResult> => {
      // The renderer may only read an exact SKILL.md path produced by the most
      // recent scan. It cannot use this channel as a general file reader.
      if (typeof instructionFile !== "string" || !allowedInstructionFiles.has(instructionFile)) {
        return { ok: false, error: "That skill is not part of the current inventory." };
      }

      try {
        const result = await readSkillContent(instructionFile);
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

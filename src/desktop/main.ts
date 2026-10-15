import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import electron from "electron";
import { getApplication, getScanContext } from "../applications.js";
import { collectAuditEvidence } from "../audit/collect.js";
import { createAuditReport } from "../audit/index.js";
import {
  compareAuditFiles,
  mergeAuditFiles,
  readAuditFileBaseline,
  writeAuditFileBaseline,
} from "../audit/integrity.js";
import {
  compareInventorySnapshots,
  createInventorySnapshot,
  isInventoryScanComplete,
  readInventorySnapshot,
  writeInventorySnapshot,
  type InventorySnapshot,
} from "../changes.js";
import { scanLocalInventory } from "../inventory-scan.js";
import {
  applyLocalSkillImport,
  planLocalSkillImport,
  undoLocalSkillImport,
  type AppliedSkillImport,
  type SkillImportPlan,
} from "../management/import-skill.js";
import { readSkillContent, type ExpectedFileIdentity } from "../skill-content.js";
import type {
  ApplicationId,
  DesktopScanResult,
  InventoryChanges,
  SkillContentResult,
  SkillImportReceipt,
  SkillImportSelection,
} from "../types.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const { app, BrowserWindow, dialog, ipcMain } = electron;
const rendererFile = path.join(currentDirectory, "renderer", "index.html");
const rendererUrl = pathToFileURL(rendererFile).href;
const SCAN_CHANNEL = "inventory:scan";
const READ_CONTENT_CHANNEL = "inventory:read-skill-content";
const RESET_BASELINE_CHANNEL = "inventory:reset-baseline";
const CHOOSE_IMPORT_CHANNEL = "management:choose-skill-import";
const APPLY_IMPORT_CHANNEL = "management:apply-skill-import";
const UNDO_IMPORT_CHANNEL = "management:undo-skill-import";

let allowedInstructionFiles = new Map<string, ExpectedFileIdentity>();
let latestSnapshot: InventorySnapshot | null = null;
let pendingImport: SkillImportPlan | null = null;
let appliedImport: AppliedSkillImport | null = null;
const trustedWindows = new Set<InstanceType<typeof BrowserWindow>>();

function requireTrustedWindow(
  event: Electron.IpcMainInvokeEvent,
): InstanceType<typeof BrowserWindow> {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (
    !window ||
    !trustedWindows.has(window) ||
    event.senderFrame !== event.sender.mainFrame ||
    event.senderFrame.url !== rendererUrl
  ) {
    throw new Error("This request did not come from the SkillManagerOS window.");
  }
  return window;
}

function registerHandlers(): void {
  ipcMain.handle(SCAN_CHANNEL, async (event): Promise<DesktopScanResult> => {
    requireTrustedWindow(event);
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
    const evidence = await collectAuditEvidence(result);
    const audit = createAuditReport(
      result,
      evidence.observations,
      context.applications.map((application) => application.id),
      scannedAt,
      evidence.files,
    );
    const auditBaselinePath = path.join(app.getPath("userData"), "audit-files.json");
    const previousAuditFiles = await readAuditFileBaseline(auditBaselinePath).catch(() => {
      audit.fileChangeTrackingError =
        "File-change tracking is unavailable because its saved baseline is invalid or unreadable. The baseline was preserved.";
      result.diagnostics.push({
        application: "chatgpt",
        location: auditBaselinePath,
        severity: "warning",
        code: "BASELINE_PRESERVED",
        message: "The audit baseline is unreadable or invalid. It was not replaced.",
      });
      return undefined;
    });
    if (previousAuditFiles !== undefined) {
      const auditComplete = audit.coverage.every((item) => item.status === "evaluated");
      audit.fileChanges = compareAuditFiles(evidence.files, previousAuditFiles, auditComplete);
      await writeAuditFileBaseline(
        auditBaselinePath,
        mergeAuditFiles(evidence.files, previousAuditFiles, auditComplete),
      );
    }

    return {
      ...result,
      scannedAt,
      changes,
      audit,
    };
  });

  ipcMain.handle(RESET_BASELINE_CHANNEL, async (event): Promise<InventoryChanges> => {
    requireTrustedWindow(event);
    if (!latestSnapshot) {
      throw new Error("Complete a full inventory scan before resetting its baseline.");
    }

    await writeInventorySnapshot(getBaselinePath(), latestSnapshot);
    return compareInventorySnapshots(latestSnapshot, null);
  });

  ipcMain.handle(
    READ_CONTENT_CHANNEL,
    async (event, instructionFile: unknown): Promise<SkillContentResult> => {
      requireTrustedWindow(event);
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

  ipcMain.handle(
    CHOOSE_IMPORT_CHANNEL,
    async (event, application: unknown): Promise<SkillImportSelection> => {
      const window = requireTrustedWindow(event);
      if (application !== "chatgpt" && application !== "claude") {
        throw new Error("Choose a supported application.");
      }
      const selected = await dialog.showOpenDialog(window, {
        title: "Choose a local skill folder",
        properties: ["openDirectory"],
      });
      if (selected.canceled || selected.filePaths.length !== 1) return { status: "cancelled" };
      const destinationRoot = getApplication(application as ApplicationId).locations.find(
        (location) => location.source === "default" && location.scope === "global",
      )?.path;
      if (!destinationRoot) throw new Error("This application has no supported skill location.");
      pendingImport = await planLocalSkillImport(
        selected.filePaths[0],
        destinationRoot,
        application,
      );
      return { status: "ready", preview: pendingImport.preview };
    },
  );

  ipcMain.handle(
    APPLY_IMPORT_CHANNEL,
    async (event, planId: unknown): Promise<SkillImportReceipt | null> => {
      const window = requireTrustedWindow(event);
      if (typeof planId !== "string" || pendingImport?.preview.id !== planId) {
        throw new Error("That import preview is no longer current.");
      }
      const plan = pendingImport;
      const confirmation = await dialog.showMessageBox(window, {
        type: "warning",
        buttons: ["Cancel", "Import skill"],
        defaultId: 0,
        cancelId: 0,
        message: "Import this local skill?",
        detail: `From: ${plan.preview.sourceDirectory}\nTo: ${plan.preview.destinationDirectory}\n${plan.preview.fileCount} files. No scripts will be run.${plan.preview.includesScripts ? " This skill contains scripts that its AI application may run later." : ""}`,
      });
      if (confirmation.response !== 1) return null;
      const result = await applyLocalSkillImport(plan);
      pendingImport = null;
      appliedImport = result;
      return result.receipt;
    },
  );

  ipcMain.handle(UNDO_IMPORT_CHANNEL, async (event, receiptId: unknown): Promise<string | null> => {
    const window = requireTrustedWindow(event);
    if (typeof receiptId !== "string" || appliedImport?.receipt.id !== receiptId) {
      throw new Error("That import is not available to undo in this session.");
    }
    const confirmation = await dialog.showMessageBox(window, {
      type: "warning",
      buttons: ["Cancel", "Move to recovery"],
      defaultId: 0,
      cancelId: 0,
      message: "Undo this skill import?",
      detail:
        "The imported folder will be moved to a hidden recovery folder, not deleted. Undo stops if the skill changed after import.",
    });
    if (confirmation.response !== 1) return null;
    const recovery = await undoLocalSkillImport(appliedImport);
    appliedImport = null;
    return recovery;
  });
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
  trustedWindows.add(window);
  window.on("closed", () => trustedWindows.delete(window));

  // The inventory has no web navigation. Denying it keeps discovered text or
  // future links from turning the desktop window into a general browser.
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());

  void window.loadFile(rendererFile);
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

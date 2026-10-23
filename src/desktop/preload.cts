import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi } from "../types.js";

const SCAN_CHANNEL = "inventory:scan";
const READ_CONTENT_CHANNEL = "inventory:read-skill-content";
const READ_AUDIT_EXCERPT_CHANNEL = "audit:read-excerpt";
const RESET_BASELINE_CHANNEL = "inventory:reset-baseline";
const CHOOSE_IMPORT_CHANNEL = "management:choose-skill-import";
const APPLY_IMPORT_CHANNEL = "management:apply-skill-import";
const UNDO_IMPORT_CHANNEL = "management:undo-skill-import";
const LIST_IMPORT_HISTORY_CHANNEL = "management:list-skill-import-history";

const desktopApi: DesktopApi = {
  scan: () => ipcRenderer.invoke(SCAN_CHANNEL),
  readSkillContent: (instructionFile) => ipcRenderer.invoke(READ_CONTENT_CHANNEL, instructionFile),
  readAuditExcerpt: (findingId) => ipcRenderer.invoke(READ_AUDIT_EXCERPT_CHANNEL, findingId),
  resetBaseline: () => ipcRenderer.invoke(RESET_BASELINE_CHANNEL),
  chooseSkillImport: (application) => ipcRenderer.invoke(CHOOSE_IMPORT_CHANNEL, application),
  applySkillImport: (planId) => ipcRenderer.invoke(APPLY_IMPORT_CHANNEL, planId),
  undoSkillImport: (receiptId) => ipcRenderer.invoke(UNDO_IMPORT_CHANNEL, receiptId),
  listSkillImportHistory: () => ipcRenderer.invoke(LIST_IMPORT_HISTORY_CHANNEL),
};

contextBridge.exposeInMainWorld("skillManager", desktopApi);

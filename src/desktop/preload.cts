import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi } from "../types.js";

const SCAN_CHANNEL = "inventory:scan";
const READ_CONTENT_CHANNEL = "inventory:read-skill-content";
const RESET_BASELINE_CHANNEL = "inventory:reset-baseline";
const CHOOSE_IMPORT_CHANNEL = "management:choose-skill-import";
const APPLY_IMPORT_CHANNEL = "management:apply-skill-import";
const UNDO_IMPORT_CHANNEL = "management:undo-skill-import";

const desktopApi: DesktopApi = {
  scan: () => ipcRenderer.invoke(SCAN_CHANNEL),
  readSkillContent: (instructionFile) => ipcRenderer.invoke(READ_CONTENT_CHANNEL, instructionFile),
  resetBaseline: () => ipcRenderer.invoke(RESET_BASELINE_CHANNEL),
  chooseSkillImport: (application) => ipcRenderer.invoke(CHOOSE_IMPORT_CHANNEL, application),
  applySkillImport: (planId) => ipcRenderer.invoke(APPLY_IMPORT_CHANNEL, planId),
  undoSkillImport: (receiptId) => ipcRenderer.invoke(UNDO_IMPORT_CHANNEL, receiptId),
};

contextBridge.exposeInMainWorld("skillManager", desktopApi);

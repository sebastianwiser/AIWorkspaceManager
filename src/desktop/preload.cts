import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi } from "../types.js";

const SCAN_CHANNEL = "inventory:scan";
const READ_CONTENT_CHANNEL = "inventory:read-skill-content";
const RESET_BASELINE_CHANNEL = "inventory:reset-baseline";

const desktopApi: DesktopApi = {
  scan: () => ipcRenderer.invoke(SCAN_CHANNEL),
  readSkillContent: (instructionFile) => ipcRenderer.invoke(READ_CONTENT_CHANNEL, instructionFile),
  resetBaseline: () => ipcRenderer.invoke(RESET_BASELINE_CHANNEL),
};

contextBridge.exposeInMainWorld("skillManager", desktopApi);

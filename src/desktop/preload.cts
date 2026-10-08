import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi } from "../types.js";

const SCAN_CHANNEL = "inventory:scan";
const READ_CONTENT_CHANNEL = "inventory:read-skill-content";

const desktopApi: DesktopApi = {
  scan: () => ipcRenderer.invoke(SCAN_CHANNEL),
  readSkillContent: (instructionFile) => ipcRenderer.invoke(READ_CONTENT_CHANNEL, instructionFile),
};

contextBridge.exposeInMainWorld("skillManager", desktopApi);

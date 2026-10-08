import type { DesktopApi } from "../../types.js";

declare global {
  interface Window {
    skillManager: DesktopApi;
  }
}

export {};

import path from "node:path";
import os from "node:os";
import type { ApplicationDefinition, ApplicationId, ScanLocationDefinition } from "./types.js";

/**
 * Applications supported by the first version of SkillManagerOS.
 *
 * Each location has a label because a skill may be installed directly by a
 * user or supplied by a local plugin. Both are useful, but they are different
 * sources and should remain distinguishable in the scan results.
 */
const claudeLocations: ScanLocationDefinition[] = [
  {
    label: "Claude skills",
    path: path.join(os.homedir(), ".claude", "skills"),
    source: "default",
  },
  {
    label: "Claude plugins",
    path: path.join(os.homedir(), ".claude", "plugins"),
    source: "plugin",
  },
];

// Claude Desktop stores local skill snapshots in Application Support on macOS.
// Keep this platform-specific path out of Windows and Linux scans.
if (process.platform === "darwin") {
  claudeLocations.push({
    label: "Claude Desktop skills",
    path: path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Claude",
      "local-agent-mode-sessions",
      "skills-plugin",
    ),
    source: "desktop-plugin",
  });
}

const APPLICATIONS: Record<ApplicationId, ApplicationDefinition> = {
  chatgpt: {
    id: "chatgpt",
    displayName: "ChatGPT",
    locations: [
      {
        label: "ChatGPT skills",
        path: path.join(os.homedir(), ".codex", "skills"),
        source: "default",
      },
      {
        label: "ChatGPT plugins",
        path: path.join(os.homedir(), ".codex", "plugins"),
        source: "plugin",
      },
    ],
  },
  claude: {
    id: "claude",
    displayName: "Claude",
    locations: claudeLocations,
  },
};

/** Return a supported application, or undefined when the ID is unknown. */
export function getApplication(applicationId: ApplicationId): ApplicationDefinition {
  return APPLICATIONS[applicationId];
}

/** Return all supported application definitions. */
export function getApplications(): ApplicationDefinition[] {
  return Object.values(APPLICATIONS);
}

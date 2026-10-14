import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  createInventoryView,
  createMcpInventoryView,
  createPluginInventoryView,
  getMcpServerIdentity,
  getPluginIdentity,
  getSkillIdentity,
} from "../../inventory.js";
import { createMcpCapabilityGroups, createSkillCapabilityGroups } from "../../capabilities.js";
import { getRenderableMarkdown } from "../../markdown.js";
import { createTextDiff } from "../../text-diff.js";
import type { TextDiffResult } from "../../text-diff.js";
import type {
  ApplicationChoice,
  CapabilityGroup,
  DesktopScanResult,
  DiscoveredMcpServer,
  DiscoveredPlugin,
  DiscoveredSkill,
  InventoryKind,
  InventorySortField,
  McpStatus,
  McpCapabilityGroup,
  MetadataStatus,
  PluginStatus,
  SkillChange,
  SkillChangeType,
  SkillContentResult,
  SkillCapabilityGroup,
  SkillSourceId,
  SkillVariantGroup,
  SortOrder,
} from "../../types.js";
import { AlertIcon, FolderIcon, MarkIcon, RefreshIcon, SearchIcon, ShieldIcon } from "./Icons.js";

type SourceFilter = SkillSourceId | "all";
type StatusFilter = MetadataStatus | "all";
type ProjectFilter = "all" | "global" | `project:${string}`;
type DetailTab = "overview" | "contents";
type ContentView = "rendered" | "source";
type InventoryMode = "inventory" | "changes";
type ChangeFilter = SkillChangeType | "all";

const sourceOptions: Array<{ value: SourceFilter; label: string }> = [
  { value: "all", label: "All sources" },
  { value: "personal", label: "Personal" },
  { value: "system", label: "System" },
  { value: "plugin", label: "Plugin" },
  { value: "plugin-cache", label: "Plugin cache" },
  { value: "claude-desktop-plugin", label: "Claude Desktop plugin" },
  { value: "project", label: "Project" },
];

const statusOptions: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All metadata" },
  { value: "valid", label: "Valid" },
  { value: "incomplete", label: "Incomplete" },
  { value: "missing", label: "Missing" },
  { value: "invalid", label: "Invalid" },
  { value: "unreadable", label: "Unreadable" },
];

const sortOptions: Array<{ value: InventorySortField; label: string }> = [
  { value: "name", label: "Name" },
  { value: "application", label: "Application" },
  { value: "source", label: "Source" },
  { value: "modified", label: "Last modified" },
];

const changeOptions: Array<{ value: ChangeFilter; label: string }> = [
  { value: "all", label: "All changes" },
  { value: "added", label: "Added" },
  { value: "modified", label: "Modified" },
  { value: "moved", label: "Moved or renamed" },
  { value: "removed", label: "Removed" },
];

export function App() {
  const [scanResult, setScanResult] = useState<DesktopScanResult | null>(null);
  const [isScanning, setIsScanning] = useState(true);
  const [isResettingBaseline, setIsResettingBaseline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<InventoryMode>("inventory");
  const [inventoryKind, setInventoryKind] = useState<InventoryKind>("skills");
  const [query, setQuery] = useState("");
  const [application, setApplication] = useState<ApplicationChoice>("all");
  const [source, setSource] = useState<SourceFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [changeType, setChangeType] = useState<ChangeFilter>("all");
  const [project, setProject] = useState<ProjectFilter>("all");
  const [sortBy, setSortBy] = useState<InventorySortField>("name");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [selectedCapabilityId, setSelectedCapabilityId] = useState<string | null>(null);

  const refreshInventory = useCallback(async () => {
    setIsScanning(true);
    setError(null);

    try {
      if (!window.skillManager) {
        throw new Error("The secure desktop bridge is unavailable.");
      }
      const result = await window.skillManager.scan();
      setScanResult(result);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : String(scanError));
    } finally {
      setIsScanning(false);
    }
  }, []);

  useEffect(() => {
    void refreshInventory();
  }, [refreshInventory]);

  const allSkills = scanResult?.skills ?? [];
  const allChanges = scanResult?.changes.items ?? [];
  const skillCapabilityGroups = useMemo(() => createSkillCapabilityGroups(allSkills), [allSkills]);
  const sourceSkills = useMemo(
    () =>
      mode === "inventory"
        ? allSkills
        : allChanges
            .filter((change) => changeType === "all" || change.type === changeType)
            .map((change) => change.skill),
    [allChanges, allSkills, changeType, mode],
  );
  const sourceCapabilityGroups = useMemo(
    () => createSkillCapabilityGroups(sourceSkills),
    [sourceSkills],
  );

  const inventory = useMemo(() => {
    return createInventoryView(sourceSkills, {
      applicationIds: application === "all" ? undefined : [application],
      query,
      sources: source === "all" ? undefined : [source],
      metadataStatuses: mode === "inventory" && status !== "all" ? [status] : undefined,
      scopes: project === "global" ? ["global"] : undefined,
      projectIds: project.startsWith("project:") ? [project.slice("project:".length)] : undefined,
      sortBy,
      sortOrder,
    });
  }, [application, mode, project, query, sortBy, sortOrder, source, sourceSkills, status]);

  const visibleCapabilityGroups = useMemo(() => {
    const orderedIds: string[] = [];
    for (const skill of inventory) {
      const group = findSkillCapabilityGroup(sourceCapabilityGroups, skill);
      if (group && !orderedIds.includes(group.id)) orderedIds.push(group.id);
    }
    return orderedIds
      .map((id) => sourceCapabilityGroups.find((group) => group.id === id))
      .filter((group): group is SkillCapabilityGroup => Boolean(group));
  }, [inventory, sourceCapabilityGroups]);

  useEffect(() => {
    if (visibleCapabilityGroups.length === 0) {
      setSelectedCapabilityId(null);
      return;
    }

    if (!visibleCapabilityGroups.some((group) => group.id === selectedCapabilityId)) {
      setSelectedCapabilityId(visibleCapabilityGroups[0].id);
    }
  }, [selectedCapabilityId, visibleCapabilityGroups]);

  const selectedCapability =
    visibleCapabilityGroups.find((group) => group.id === selectedCapabilityId) ??
    visibleCapabilityGroups[0] ??
    null;
  const selectedChanges = selectedCapability
    ? allChanges.filter((change) =>
        selectedCapability.definitions.some(
          (definition) => getSkillIdentity(definition) === getSkillIdentity(change.skill),
        ),
      )
    : [];
  const chatGptCount = allSkills.filter((skill) => skill.application === "chatgpt").length;
  const claudeCount = allSkills.filter((skill) => skill.application === "claude").length;
  const attentionCount = allSkills.filter((skill) => skill.metadataStatus !== "valid").length;
  const warningCount =
    scanResult?.diagnostics.filter((item) => item.severity === "warning").length ?? 0;
  const missingLocationCount =
    scanResult?.diagnostics.filter((item) => item.code === "LOCATION_NOT_FOUND").length ?? 0;
  const projectOptionSkills = useMemo(
    () => [...allSkills, ...allChanges.map((change) => change.skill)],
    [allChanges, allSkills],
  );
  const projectOptions = useMemo(
    () => getProjectOptions(projectOptionSkills, application),
    [application, projectOptionSkills],
  );
  const hasActiveFilters =
    query !== "" ||
    application !== "all" ||
    project !== "all" ||
    source !== "all" ||
    (mode === "inventory" && status !== "all") ||
    (mode === "changes" && changeType !== "all");

  function clearFilters(): void {
    setQuery("");
    setApplication("all");
    setProject("all");
    setSource("all");
    setStatus("all");
    setChangeType("all");
  }

  async function resetBaseline(): Promise<void> {
    if (
      !window.confirm(
        "Use the current inventory as the new baseline? The existing change list will be cleared.",
      )
    ) {
      return;
    }

    setIsResettingBaseline(true);
    setError(null);
    try {
      const changes = await window.skillManager.resetBaseline();
      setScanResult((current) => (current ? { ...current, changes } : current));
      setMode("inventory");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : String(resetError));
    } finally {
      setIsResettingBaseline(false);
    }
  }

  useEffect(() => {
    if (
      project.startsWith("project:") &&
      !projectOptions.some((option) => `project:${option.id}` === project)
    ) {
      setProject("all");
    }
  }, [project, projectOptions]);

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="brand">
          <MarkIcon className="brand-mark" />
          <div>
            <p className="eyebrow">LOCAL INVENTORY</p>
            <h1>SkillManagerOS</h1>
          </div>
        </div>

        <nav className="inventory-kind-switch" aria-label="Inventory type">
          <button
            type="button"
            className={inventoryKind === "skills" ? "active" : ""}
            aria-current={inventoryKind === "skills" ? "page" : undefined}
            onClick={() => setInventoryKind("skills")}
          >
            Skills
          </button>
          <button
            type="button"
            className={inventoryKind === "mcp" ? "active" : ""}
            aria-current={inventoryKind === "mcp" ? "page" : undefined}
            onClick={() => setInventoryKind("mcp")}
          >
            MCP Servers
          </button>
          <button
            type="button"
            className={inventoryKind === "plugins" ? "active" : ""}
            aria-current={inventoryKind === "plugins" ? "page" : undefined}
            onClick={() => setInventoryKind("plugins")}
          >
            Plugins
          </button>
        </nav>

        <div className="titlebar-actions">
          <div className="read-only-badge">
            <ShieldIcon />
            Read-only
          </div>
          <button
            className="rescan-button"
            type="button"
            onClick={refreshInventory}
            disabled={isScanning}
          >
            <RefreshIcon className={isScanning ? "spinning" : ""} />
            {isScanning ? "Scanning…" : "Rescan"}
          </button>
        </div>
      </header>

      <main>
        {inventoryKind === "mcp" ? (
          <McpInventoryPanel
            scanResult={scanResult}
            isScanning={isScanning}
            error={error}
            onRetry={refreshInventory}
          />
        ) : inventoryKind === "plugins" ? (
          <PluginInventoryPanel
            scanResult={scanResult}
            isScanning={isScanning}
            error={error}
            onRetry={refreshInventory}
          />
        ) : (
          <>
            <section className="intro-row" aria-labelledby="inventory-heading">
              <div>
                <p className="section-kicker">SKILL LIBRARY</p>
                <h2 id="inventory-heading">Everything installed, in one place.</h2>
                <p>
                  Browse the local skills available to ChatGPT and Claude without changing a file.
                </p>
              </div>
              {scanResult && (
                <p className="scan-time">
                  Last scanned{" "}
                  <time dateTime={scanResult.scannedAt}>{formatTime(scanResult.scannedAt)}</time>
                </p>
              )}
            </section>

            <section className="summary-strip" aria-label="Inventory summary">
              <SummaryMetric
                label="Capability groups"
                value={skillCapabilityGroups.length}
                tone="ink"
              />
              <SummaryMetric label="Definitions" value={allSkills.length} tone="ink" />
              <SummaryMetric label="ChatGPT" value={chatGptCount} tone="green" />
              <SummaryMetric label="Claude" value={claudeCount} tone="orange" />
              <SummaryMetric label="Needs attention" value={attentionCount} tone="yellow" />
            </section>

            {scanResult && (
              <ChangeSummary
                changes={scanResult.changes.items}
                baselineCreated={scanResult.changes.baselineCreated}
                baselineScannedAt={scanResult.changes.baselineScannedAt}
                onViewChanges={() => setMode("changes")}
                onReset={() => void resetBaseline()}
                isResetting={isResettingBaseline}
              />
            )}

            {error && (
              <div className="message error-message" role="alert">
                <AlertIcon />
                <div>
                  <strong>The local inventory could not be scanned.</strong>
                  <span>{error}</span>
                </div>
                <button type="button" onClick={refreshInventory}>
                  Try again
                </button>
              </div>
            )}

            {!error && warningCount > 0 && (
              <div className="message warning-message" role="status">
                <AlertIcon />
                <span>
                  {warningCount} scan warning{warningCount === 1 ? "" : "s"} need attention.
                </span>
              </div>
            )}

            <section className="inventory-card">
              <div className="inventory-tabs" role="tablist" aria-label="Inventory view">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "inventory"}
                  className={mode === "inventory" ? "active" : ""}
                  onClick={() => setMode("inventory")}
                >
                  Inventory
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "changes"}
                  className={mode === "changes" ? "active" : ""}
                  onClick={() => setMode("changes")}
                >
                  Changes
                  {allChanges.length > 0 && <span>{allChanges.length}</span>}
                </button>
              </div>
              <div className="controls">
                <label className="search-control">
                  <span className="visually-hidden">Search skills</span>
                  <SearchIcon />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search skills and descriptions"
                  />
                </label>

                <SelectControl
                  label="Application"
                  value={application}
                  onChange={(value) => setApplication(value as ApplicationChoice)}
                >
                  <option value="all">All applications</option>
                  <option value="chatgpt">ChatGPT</option>
                  <option value="claude">Claude</option>
                </SelectControl>

                <SelectControl
                  label="Project"
                  value={project}
                  onChange={(value) => setProject(value as ProjectFilter)}
                >
                  <option value="all">All locations</option>
                  <option value="global">Global only</option>
                  {projectOptions.map((option) => (
                    <option key={option.id} value={`project:${option.id}`}>
                      {option.name}
                    </option>
                  ))}
                </SelectControl>

                <SelectControl
                  label="Source"
                  value={source}
                  onChange={(value) => setSource(value as SourceFilter)}
                >
                  {sourceOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </SelectControl>

                {mode === "inventory" ? (
                  <SelectControl
                    label="Metadata"
                    value={status}
                    onChange={(value) => setStatus(value as StatusFilter)}
                  >
                    {statusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </SelectControl>
                ) : (
                  <SelectControl
                    label="Change"
                    value={changeType}
                    onChange={(value) => setChangeType(value as ChangeFilter)}
                  >
                    {changeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </SelectControl>
                )}

                <SelectControl
                  label="Sort by"
                  value={sortBy}
                  onChange={(value) => setSortBy(value as InventorySortField)}
                >
                  {sortOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </SelectControl>

                <button
                  className="order-button"
                  type="button"
                  onClick={() => setSortOrder((current) => (current === "asc" ? "desc" : "asc"))}
                  aria-label={`Change to ${sortOrder === "asc" ? "descending" : "ascending"} order`}
                >
                  {sortOrder === "asc" ? "A → Z" : "Z → A"}
                </button>
              </div>

              <div className="inventory-meta">
                <span>
                  <strong>{visibleCapabilityGroups.length}</strong> skill blocks ·{" "}
                  {inventory.length} matching{" "}
                  {inventory.length === 1 ? "definition" : "definitions"}
                </span>
                {missingLocationCount > 0 && (
                  <span>{missingLocationCount} optional locations not present</span>
                )}
              </div>

              <div className="inventory-layout">
                <div className="skill-list" aria-label="Skills">
                  {isScanning && !scanResult ? (
                    <LoadingList />
                  ) : visibleCapabilityGroups.length > 0 ? (
                    visibleCapabilityGroups.map((capability) => (
                      <SkillCapabilityRow
                        key={capability.id}
                        capability={capability}
                        selected={capability.id === selectedCapabilityId}
                        changes={
                          mode === "changes"
                            ? allChanges.filter((change) =>
                                capability.definitions.some(
                                  (definition) =>
                                    getSkillIdentity(definition) === getSkillIdentity(change.skill),
                                ),
                              )
                            : []
                        }
                        onSelect={() => setSelectedCapabilityId(capability.id)}
                      />
                    ))
                  ) : (
                    <EmptyInventory
                      mode={mode}
                      hasActiveFilters={hasActiveFilters}
                      onClear={clearFilters}
                    />
                  )}
                </div>

                <aside className="detail-panel" aria-label="Selected skill details">
                  {selectedCapability ? (
                    <SkillDetails
                      key={`${selectedCapability.id}:${mode}`}
                      capability={selectedCapability}
                      changes={selectedChanges}
                    />
                  ) : (
                    <EmptyDetails />
                  )}
                </aside>
              </div>
            </section>
          </>
        )}
      </main>

      <footer>
        <ShieldIcon />
        Local-only discovery · No skills, plugins, or MCP servers are executed or changed
      </footer>
    </div>
  );
}

function PluginInventoryPanel({
  scanResult,
  isScanning,
  error,
  onRetry,
}: {
  scanResult: DesktopScanResult | null;
  isScanning: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const [query, setQuery] = useState("");
  const [application, setApplication] = useState<ApplicationChoice>("all");
  const [project, setProject] = useState<ProjectFilter>("all");
  const [status, setStatus] = useState<PluginStatus | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const plugins = scanResult?.plugins ?? [];
  const projects = useMemo(
    () => getPluginProjectOptions(plugins, application),
    [application, plugins],
  );
  const filtered = useMemo(
    () =>
      createPluginInventoryView(plugins, {
        applicationIds: application === "all" ? undefined : [application],
        query,
        scopes: project === "global" ? ["global"] : undefined,
        projectIds: project.startsWith("project:") ? [project.slice("project:".length)] : undefined,
        statuses: status === "all" ? undefined : [status],
      }),
    [application, plugins, project, query, status],
  );

  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedId(null);
    } else if (!filtered.some((plugin) => getPluginIdentity(plugin) === selectedId)) {
      setSelectedId(getPluginIdentity(filtered[0]));
    }
  }, [filtered, selectedId]);

  useEffect(() => {
    if (
      project.startsWith("project:") &&
      !projects.some((option) => `project:${option.id}` === project)
    ) {
      setProject("all");
    }
  }, [project, projects]);

  const selected =
    filtered.find((plugin) => getPluginIdentity(plugin) === selectedId) ?? filtered[0] ?? null;
  const attentionCount = plugins.filter((plugin) => plugin.status !== "valid").length;
  const pluginWarnings =
    scanResult?.diagnostics.filter(
      (diagnostic) => diagnostic.severity === "warning" && diagnostic.code.startsWith("PLUGIN_"),
    ) ?? [];
  const hasFilters = query !== "" || application !== "all" || project !== "all" || status !== "all";

  function clearFilters(): void {
    setQuery("");
    setApplication("all");
    setProject("all");
    setStatus("all");
  }

  return (
    <>
      <section className="intro-row" aria-labelledby="plugin-heading">
        <div>
          <p className="section-kicker">PLUGIN INVENTORY</p>
          <h2 id="plugin-heading">See the packages behind your capabilities.</h2>
          <p>
            Review installed bundles and the skills, MCP servers, apps, and hooks they bring with
            them.
          </p>
        </div>
        {scanResult && (
          <p className="scan-time">
            Last scanned{" "}
            <time dateTime={scanResult.scannedAt}>{formatTime(scanResult.scannedAt)}</time>
          </p>
        )}
      </section>

      <section className="summary-strip" aria-label="Plugin inventory summary">
        <SummaryMetric label="Installed plugins" value={plugins.length} tone="ink" />
        <SummaryMetric
          label="Included skills"
          value={plugins.reduce((total, plugin) => total + plugin.skills.length, 0)}
          tone="green"
        />
        <SummaryMetric
          label="Packaged MCP"
          value={plugins.reduce((total, plugin) => total + plugin.mcpServers.length, 0)}
          tone="orange"
        />
        <SummaryMetric
          label="Connected apps"
          value={plugins.reduce((total, plugin) => total + plugin.apps.length, 0)}
          tone="ink"
        />
        <SummaryMetric label="Needs attention" value={attentionCount} tone="yellow" />
      </section>

      {error && (
        <div className="message error-message" role="alert">
          <AlertIcon />
          <div>
            <strong>The local inventory could not be scanned.</strong>
            <span>{error}</span>
          </div>
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
      {!error && pluginWarnings.length > 0 && (
        <div className="message warning-message" role="status">
          <AlertIcon />
          <div>
            <strong>
              {pluginWarnings.length} plugin warning{pluginWarnings.length === 1 ? "" : "s"} need
              attention.
            </strong>
            {pluginWarnings.slice(0, 3).map((warning) => (
              <span key={`${warning.location}:${warning.message}`}>
                {warning.message} ({shortenPath(warning.location)})
              </span>
            ))}
          </div>
        </div>
      )}

      <section className="inventory-card">
        <div className="controls plugin-controls">
          <label className="search-control">
            <span className="visually-hidden">Search plugins and included components</span>
            <SearchIcon />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search plugins or components"
            />
          </label>
          <SelectControl
            label="Application"
            value={application}
            onChange={(value) => setApplication(value as ApplicationChoice)}
          >
            <option value="all">All applications</option>
            <option value="chatgpt">ChatGPT</option>
            <option value="claude">Claude</option>
          </SelectControl>
          <SelectControl
            label="Project"
            value={project}
            onChange={(value) => setProject(value as ProjectFilter)}
          >
            <option value="all">All locations</option>
            <option value="global">Global only</option>
            {projects.map((option) => (
              <option key={option.id} value={`project:${option.id}`}>
                {option.name}
              </option>
            ))}
          </SelectControl>
          <SelectControl
            label="Manifest"
            value={status}
            onChange={(value) => setStatus(value as PluginStatus | "all")}
          >
            <option value="all">All manifests</option>
            <option value="valid">Valid</option>
            <option value="incomplete">Incomplete</option>
            <option value="invalid">Invalid</option>
          </SelectControl>
          {hasFilters && (
            <button className="order-button" type="button" onClick={clearFilters}>
              Clear
            </button>
          )}
        </div>
        <div className="inventory-meta">
          <span>
            <strong>{filtered.length}</strong> of {plugins.length} installed plugins
          </span>
          <span>Marketplace catalogs are excluded</span>
        </div>
        <div className="inventory-layout">
          <div className="skill-list" aria-label="Installed plugins">
            {isScanning && !scanResult ? (
              <LoadingList />
            ) : filtered.length > 0 ? (
              filtered.map((plugin) => (
                <PluginRow
                  key={getPluginIdentity(plugin)}
                  plugin={plugin}
                  selected={getPluginIdentity(plugin) === selectedId}
                  onSelect={() => setSelectedId(getPluginIdentity(plugin))}
                />
              ))
            ) : (
              <div className="empty-state">
                <h3>
                  {hasFilters ? "No plugins match these filters" : "No installed plugins found"}
                </h3>
                <p>
                  {hasFilters
                    ? "Clear the filters to see the complete plugin inventory."
                    : "Install or sync a plugin in ChatGPT or Claude, then rescan."}
                </p>
                {hasFilters && (
                  <button type="button" onClick={clearFilters}>
                    Clear filters
                  </button>
                )}
              </div>
            )}
          </div>
          <aside className="detail-panel" aria-label="Selected plugin details">
            {selected ? <PluginDetails plugin={selected} /> : <EmptyPluginDetails />}
          </aside>
        </div>
      </section>
    </>
  );
}

function PluginRow({
  plugin,
  selected,
  onSelect,
}: {
  plugin: DiscoveredPlugin;
  selected: boolean;
  onSelect: () => void;
}) {
  const componentCount =
    plugin.skills.length +
    plugin.mcpServers.length +
    plugin.apps.length +
    (plugin.hasHooks ? 1 : 0);
  return (
    <button
      className={`skill-row plugin-row${selected ? " selected" : ""}`}
      type="button"
      onClick={onSelect}
    >
      <span className={`app-monogram app-${plugin.application}`}>
        {plugin.application === "chatgpt" ? "G" : "C"}
      </span>
      <span className="skill-row-copy">
        <span className="skill-name-line">
          <strong>{plugin.displayName}</strong>
          {plugin.version && <span className="plugin-version">v{plugin.version}</span>}
        </span>
        <span>{plugin.description ?? "No description provided"}</span>
        <span className="row-meta">
          {plugin.applicationName} · {plugin.originName} · {componentCount}{" "}
          {componentCount === 1 ? "component" : "components"}
        </span>
      </span>
      <span className="row-status">
        <PluginStatusPill status={plugin.status} />
      </span>
    </button>
  );
}

function PluginDetails({ plugin }: { plugin: DiscoveredPlugin }) {
  return (
    <div className="detail-content">
      <div className="detail-heading">
        <span className="plugin-detail-mark">P</span>
        <div>
          <p>{plugin.applicationName} plugin</p>
          <h3>{plugin.displayName}</h3>
        </div>
      </div>

      <p className="detail-description">
        {plugin.description ?? "This plugin does not provide a description."}
      </p>

      <dl className="detail-list">
        <div>
          <dt>Status</dt>
          <dd>
            <PluginStatusPill status={plugin.status} />
          </dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>{plugin.version ?? "Not declared"}</dd>
        </div>
        <div>
          <dt>Publisher</dt>
          <dd>{plugin.author ?? "Not declared"}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{plugin.originName}</dd>
        </div>
        <div>
          <dt>Availability</dt>
          <dd>{plugin.projectName ? `Project: ${plugin.projectName}` : "Global"}</dd>
        </div>
        <div>
          <dt>Manifest</dt>
          <dd>{capitalize(plugin.manifestFormat)}</dd>
        </div>
      </dl>

      {plugin.issues.length > 0 && (
        <div className="issues-box">
          <strong>Manifest notes</strong>
          <ul>
            {plugin.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      <PluginComponents plugin={plugin} />

      {(plugin.license || plugin.homepage || plugin.repository) && (
        <section className="plugin-provenance" aria-label="Plugin provenance">
          <strong>Provenance</strong>
          {plugin.license && <span>License · {plugin.license}</span>}
          {plugin.repository && <code>{plugin.repository}</code>}
          {!plugin.repository && plugin.homepage && <code>{plugin.homepage}</code>}
        </section>
      )}

      <div className="location-block">
        <span>
          <FolderIcon /> Plugin location
        </span>
        <code>{shortenPath(plugin.directory)}</code>
      </div>
      <div className="location-block">
        <span>
          <FolderIcon /> Manifest file
        </span>
        <code>{shortenPath(plugin.manifestFile)}</code>
      </div>
    </div>
  );
}

function PluginComponents({ plugin }: { plugin: DiscoveredPlugin }) {
  const isEmpty =
    plugin.skills.length === 0 &&
    plugin.mcpServers.length === 0 &&
    plugin.apps.length === 0 &&
    !plugin.hasHooks;

  return (
    <section className="plugin-components" aria-label="Included plugin components">
      <div className="plugin-components-heading">
        <span>Included components</span>
        <strong>
          {plugin.skills.length +
            plugin.mcpServers.length +
            plugin.apps.length +
            (plugin.hasHooks ? 1 : 0)}
        </strong>
      </div>
      {isEmpty ? (
        <p className="plugin-components-empty">No supported components were detected.</p>
      ) : (
        <div className="component-groups">
          {plugin.skills.length > 0 && (
            <PluginComponentGroup
              label="Skills"
              count={plugin.skills.length}
              names={plugin.skills.map((skill) => skill.name)}
            />
          )}
          {plugin.mcpServers.length > 0 && (
            <PluginComponentGroup
              label="MCP servers"
              count={plugin.mcpServers.length}
              names={plugin.mcpServers.map((server) => server.name)}
            />
          )}
          {plugin.apps.length > 0 && (
            <PluginComponentGroup label="Apps" count={plugin.apps.length} names={plugin.apps} />
          )}
          {plugin.hasHooks && (
            <PluginComponentGroup label="Hooks" count={1} names={["Lifecycle hooks"]} />
          )}
        </div>
      )}
    </section>
  );
}

function PluginComponentGroup({
  label,
  count,
  names,
}: {
  label: string;
  count: number;
  names: readonly string[];
}) {
  return (
    <section className="component-group">
      <div>
        <strong>{label}</strong>
        <span>{count}</span>
      </div>
      <ul>
        {names.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </section>
  );
}

function PluginStatusPill({ status }: { status: PluginStatus }) {
  return <span className={`status-pill status-${status}`}>{capitalize(status)}</span>;
}

function EmptyPluginDetails() {
  return (
    <div className="empty-details">
      <span className="plugin-detail-mark">P</span>
      <h3>Select a plugin</h3>
      <p>Its publisher, source, manifest, and included components will appear here.</p>
    </div>
  );
}

function McpInventoryPanel({
  scanResult,
  isScanning,
  error,
  onRetry,
}: {
  scanResult: DesktopScanResult | null;
  isScanning: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const [query, setQuery] = useState("");
  const [application, setApplication] = useState<ApplicationChoice>("all");
  const [project, setProject] = useState<ProjectFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const servers = scanResult?.mcpServers ?? [];
  const capabilityGroups = useMemo(() => createMcpCapabilityGroups(servers), [servers]);
  const projects = useMemo(
    () => getMcpProjectOptions(servers, application),
    [servers, application],
  );
  const filtered = useMemo(
    () =>
      createMcpInventoryView(servers, {
        applicationIds: application === "all" ? undefined : [application],
        query,
        scopes: project === "global" ? ["global"] : undefined,
        projectIds: project.startsWith("project:") ? [project.slice("project:".length)] : undefined,
      }),
    [application, project, query, servers],
  );

  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedId(null);
    } else if (!filtered.some((server) => getMcpServerIdentity(server) === selectedId)) {
      setSelectedId(getMcpServerIdentity(filtered[0]));
    }
  }, [filtered, selectedId]);

  useEffect(() => {
    if (
      project.startsWith("project:") &&
      !projects.some((option) => `project:${option.id}` === project)
    ) {
      setProject("all");
    }
  }, [project, projects]);

  const selected =
    filtered.find((server) => getMcpServerIdentity(server) === selectedId) ?? filtered[0] ?? null;
  const selectedCapability = selected ? findMcpCapabilityGroup(capabilityGroups, selected) : null;
  const invalidCount = servers.filter((server) => server.status !== "valid").length;
  const mcpWarnings =
    scanResult?.diagnostics.filter(
      (diagnostic) => diagnostic.severity === "warning" && diagnostic.code.startsWith("MCP_"),
    ) ?? [];
  const warningCount = mcpWarnings.length;
  const hasFilters = query !== "" || application !== "all" || project !== "all";

  return (
    <>
      <section className="intro-row" aria-labelledby="mcp-heading">
        <div>
          <p className="section-kicker">MCP INVENTORY</p>
          <h2 id="mcp-heading">Every local connection, without connecting.</h2>
          <p>
            Inspect the MCP servers configured for ChatGPT and Claude. Secret values stay hidden.
          </p>
        </div>
        {scanResult && (
          <p className="scan-time">
            Last scanned{" "}
            <time dateTime={scanResult.scannedAt}>{formatTime(scanResult.scannedAt)}</time>
          </p>
        )}
      </section>

      <section className="summary-strip" aria-label="MCP inventory summary">
        <SummaryMetric label="Connection groups" value={capabilityGroups.length} tone="ink" />
        <SummaryMetric label="Configurations" value={servers.length} tone="ink" />
        <SummaryMetric
          label="ChatGPT"
          value={servers.filter((server) => server.application === "chatgpt").length}
          tone="green"
        />
        <SummaryMetric
          label="Claude"
          value={servers.filter((server) => server.application === "claude").length}
          tone="orange"
        />
        <SummaryMetric label="Needs attention" value={invalidCount} tone="yellow" />
      </section>

      {error && (
        <div className="message error-message" role="alert">
          <AlertIcon />
          <div>
            <strong>The local inventory could not be scanned.</strong>
            <span>{error}</span>
          </div>
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
      {!error && warningCount > 0 && (
        <div className="message warning-message" role="status">
          <AlertIcon />
          <div>
            <strong>
              {warningCount} MCP configuration warning{warningCount === 1 ? "" : "s"} need
              attention.
            </strong>
            {mcpWarnings.slice(0, 3).map((warning) => (
              <span key={`${warning.code}:${warning.location}:${warning.message}`}>
                {warning.message} ({shortenPath(warning.location)})
              </span>
            ))}
          </div>
        </div>
      )}

      <section className="inventory-card">
        <div className="controls mcp-controls">
          <label className="search-control">
            <span className="visually-hidden">Search MCP servers</span>
            <SearchIcon />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search MCP servers"
            />
          </label>
          <SelectControl
            label="Application"
            value={application}
            onChange={(value) => setApplication(value as ApplicationChoice)}
          >
            <option value="all">All applications</option>
            <option value="chatgpt">ChatGPT</option>
            <option value="claude">Claude</option>
          </SelectControl>
          <SelectControl
            label="Project"
            value={project}
            onChange={(value) => setProject(value as ProjectFilter)}
          >
            <option value="all">All locations</option>
            <option value="global">Global only</option>
            {projects.map((option) => (
              <option key={option.id} value={`project:${option.id}`}>
                {option.name}
              </option>
            ))}
          </SelectControl>
          {hasFilters && (
            <button
              className="order-button"
              type="button"
              onClick={() => {
                setQuery("");
                setApplication("all");
                setProject("all");
              }}
            >
              Clear
            </button>
          )}
        </div>
        <div className="inventory-meta">
          <span>
            <strong>{filtered.length}</strong> of {servers.length} servers
          </span>
          <span>Configuration values are redacted locally</span>
        </div>
        <div className="inventory-layout">
          <div className="skill-list" aria-label="MCP servers">
            {isScanning && !scanResult ? (
              <LoadingList />
            ) : filtered.length > 0 ? (
              filtered.map((server) => (
                <McpServerRow
                  key={getMcpServerIdentity(server)}
                  server={server}
                  capability={findMcpCapabilityGroup(capabilityGroups, server)}
                  selected={getMcpServerIdentity(server) === selectedId}
                  onSelect={() => setSelectedId(getMcpServerIdentity(server))}
                />
              ))
            ) : (
              <div className="empty-state">
                <h3>{hasFilters ? "No servers match these filters" : "No MCP servers found"}</h3>
                <p>
                  {hasFilters
                    ? "Clear the filters to see the complete MCP inventory."
                    : "Add an MCP configuration to ChatGPT or Claude, then rescan."}
                </p>
              </div>
            )}
          </div>
          <aside className="detail-panel" aria-label="Selected MCP server details">
            {selected ? (
              <McpServerDetails server={selected} capability={selectedCapability} />
            ) : (
              <EmptyMcpDetails />
            )}
          </aside>
        </div>
      </section>
    </>
  );
}

function McpServerRow({
  server,
  capability,
  selected,
  onSelect,
}: {
  server: DiscoveredMcpServer;
  capability: McpCapabilityGroup | null;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button className={`skill-row${selected ? " selected" : ""}`} type="button" onClick={onSelect}>
      <span className={`app-monogram app-${server.application}`}>
        {server.application === "chatgpt" ? "G" : "C"}
      </span>
      <span className="skill-row-copy">
        <span className="skill-name-line">
          <strong>{server.name}</strong>
          {capability && capability.applications.length > 1 && (
            <span className="coverage-badge">{capability.applications.length} apps</span>
          )}
        </span>
        <span>{server.command ?? server.url ?? "No usable endpoint configured"}</span>
        <span className="row-meta">
          {server.applicationName} · {server.projectName ?? "Global"} ·{" "}
          {server.transport.toUpperCase()}
        </span>
      </span>
      <span className="row-status">
        <McpStatusPill status={server.status} />
      </span>
    </button>
  );
}

function McpServerDetails({
  server,
  capability,
}: {
  server: DiscoveredMcpServer;
  capability: McpCapabilityGroup | null;
}) {
  return (
    <div className="detail-content">
      <div className="detail-heading">
        <span className={`app-monogram app-${server.application}`}>
          {server.application === "chatgpt" ? "G" : "C"}
        </span>
        <div>
          <p>{server.applicationName}</p>
          <h3>{server.name}</h3>
        </div>
      </div>
      {capability && <CapabilityCoverage capability={capability} />}
      <dl className="detail-list">
        <div>
          <dt>Status</dt>
          <dd>
            <McpStatusPill status={server.status} />
          </dd>
        </div>
        <div>
          <dt>Availability</dt>
          <dd>{server.projectName ? `Project: ${server.projectName}` : "Global"}</dd>
        </div>
        <div>
          <dt>Transport</dt>
          <dd>{server.transport.toUpperCase()}</dd>
        </div>
        {server.command && (
          <div>
            <dt>Command</dt>
            <dd>
              <code>{server.command}</code>
            </dd>
          </div>
        )}
        {server.arguments.length > 0 && (
          <div>
            <dt>Arguments</dt>
            <dd>
              <code>{server.arguments.join(" ")}</code>
            </dd>
          </div>
        )}
        {server.url && (
          <div>
            <dt>URL</dt>
            <dd>
              <code>{server.url}</code>
            </dd>
          </div>
        )}
        <div>
          <dt>Environment</dt>
          <dd>
            {server.environmentVariables.length > 0
              ? server.environmentVariables.join(", ")
              : "None declared"}
          </dd>
        </div>
        <div>
          <dt>Headers</dt>
          <dd>{server.headerNames.length > 0 ? server.headerNames.join(", ") : "None declared"}</dd>
        </div>
      </dl>
      {server.issues.length > 0 && (
        <div className="issues-box">
          <strong>Configuration notes</strong>
          <ul>
            {server.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="location-block">
        <span>
          <FolderIcon /> Configuration file
        </span>
        <code>{shortenPath(server.configurationFile)}</code>
      </div>
      <section
        className="skill-contents mcp-configuration"
        aria-label="Sanitized MCP configuration"
      >
        <div className="content-heading">
          <div>
            <strong>Sanitized source</strong>
            <span>Secret values are replaced before display</span>
          </div>
        </div>
        <pre className="skill-content-code">{server.safeConfiguration}</pre>
      </section>
    </div>
  );
}

function McpStatusPill({ status }: { status: McpStatus }) {
  return <span className={`status-pill status-${status}`}>{capitalize(status)}</span>;
}

function CapabilityCoverage({ capability }: { capability: CapabilityGroup }) {
  const isCrossApp = capability.applications.length > 1;
  const evidence =
    capability.matchBasis === "shared-location"
      ? "Both apps use the same local skill definition."
      : capability.matchBasis === "shared-endpoint"
        ? "Both apps point to the same local server endpoint."
        : capability.matchBasis === "matching-name"
          ? "The names match across apps. Review the definitions before treating them as identical."
          : `Found in ${applicationLabel(capability.applications[0])} only.`;

  return (
    <section
      className={`capability-coverage${isCrossApp ? " cross-app" : ""}`}
      aria-label="Cross-app availability"
    >
      <div className="coverage-heading">
        <div>
          <span className="coverage-kicker">Cross-app identity</span>
          <strong>{isCrossApp ? "Available across apps" : "One app found"}</strong>
        </div>
        <div className="application-chips" aria-label="Applications">
          {capability.applications.map((application) => (
            <span key={application} className={`application-chip app-chip-${application}`}>
              {applicationLabel(application)}
            </span>
          ))}
        </div>
      </div>
      <p>{evidence}</p>
      {capability.definitions.length > 1 && (
        <span className="definition-count">
          {capability.definitions.length} local definitions represented
        </span>
      )}
    </section>
  );
}

function EmptyMcpDetails() {
  return (
    <div className="empty-details">
      <h3>Select an MCP server</h3>
      <p>Its scope, transport, endpoint, and sanitized configuration will appear here.</p>
    </div>
  );
}

function ChangeSummary({
  changes,
  baselineCreated,
  baselineScannedAt,
  onViewChanges,
  onReset,
  isResetting,
}: {
  changes: readonly SkillChange[];
  baselineCreated: boolean;
  baselineScannedAt: string | null;
  onViewChanges: () => void;
  onReset: () => void;
  isResetting: boolean;
}) {
  const counts = countChanges(changes);

  return (
    <section className="change-summary" aria-label="Changes since previous scan">
      <div className="change-summary-copy">
        <strong>
          {baselineCreated ? "Change tracking is ready" : "Changes since your last scan"}
        </strong>
        <span>
          {baselineCreated
            ? "This scan is the baseline. Future rescans will show what changed."
            : baselineScannedAt
              ? `Compared with ${formatDate(baselineScannedAt)}.`
              : "Compared with the previous inventory."}
        </span>
      </div>
      {!baselineCreated && (
        <div className="change-counts" aria-label={`${changes.length} total changes`}>
          <span className="change-added">+{counts.added} added</span>
          <span className="change-modified">{counts.modified} modified</span>
          <span className="change-moved">{counts.moved} moved</span>
          <span className="change-removed">−{counts.removed} removed</span>
        </div>
      )}
      <div className="change-summary-actions">
        {!baselineCreated && changes.length > 0 && (
          <button type="button" className="view-changes-button" onClick={onViewChanges}>
            View changes
          </button>
        )}
        <button
          type="button"
          className="reset-baseline-button"
          onClick={onReset}
          disabled={isResetting}
        >
          {isResetting ? "Resetting…" : "Reset baseline"}
        </button>
      </div>
    </section>
  );
}

function SummaryMetric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <article className={`summary-metric stat-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function SelectControl({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="select-control">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}

function SkillCapabilityRow({
  capability,
  selected,
  changes,
  onSelect,
}: {
  capability: SkillCapabilityGroup;
  selected: boolean;
  changes: readonly SkillChange[];
  onSelect: () => void;
}) {
  const description =
    capability.definitions.find((definition) => definition.description)?.description ??
    "No description provided.";
  const status = getCapabilityMetadataStatus(capability);

  return (
    <button
      className={`skill-row capability-row${selected ? " selected" : ""}`}
      type="button"
      onClick={onSelect}
    >
      <span className="capability-mark">
        <MarkIcon />
      </span>
      <span className="skill-row-copy">
        <span className="skill-name-line">
          <strong>{capability.name}</strong>
          {capability.variants.length > 1 && (
            <span className="variant-badge">{capability.variants.length} variants</span>
          )}
        </span>
        <span>{description}</span>
        <span className="row-meta">
          <span className="row-apps">
            {capability.applications.map((app) => (
              <span key={app} className={`row-app row-app-${app}`}>
                {applicationLabel(app)}
              </span>
            ))}
          </span>
          <span>
            {capability.definitions.length}{" "}
            {capability.definitions.length === 1 ? "definition" : "definitions"}
          </span>
        </span>
      </span>
      <span className="row-status">
        {changes.length === 1 && <ChangePill type={changes[0].type} />}
        {changes.length > 1 && <span className="change-pill">{changes.length} changes</span>}
        <StatusPill status={status} />
      </span>
    </button>
  );
}

function SkillDetails({
  capability,
  changes,
}: {
  capability: SkillCapabilityGroup;
  changes: readonly SkillChange[];
}) {
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [contentResult, setContentResult] = useState<SkillContentResult | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState(capability.variants[0]?.id ?? "");
  const detailRef = useRef<HTMLDivElement>(null);
  const variant =
    capability.variants.find((item) => item.id === selectedVariantId) ?? capability.variants[0];
  const skill = getVariantRepresentative(variant);
  const change =
    changes.find((item) =>
      variant.definitions.some(
        (definition) => getSkillIdentity(definition) === getSkillIdentity(item.skill),
      ),
    ) ?? null;
  const canReadContent = change?.type !== "removed";

  useEffect(() => {
    if (!capability.variants.some((item) => item.id === selectedVariantId)) {
      setSelectedVariantId(capability.variants[0]?.id ?? "");
    }
  }, [capability.variants, selectedVariantId]);

  useEffect(() => {
    detailRef.current?.scrollTo({ top: 0 });
  }, [activeTab, variant.instructionFile]);

  useEffect(() => {
    if (activeTab !== "contents" || !canReadContent) {
      return;
    }

    let ignoreResult = false;
    setContentResult(null);

    void window.skillManager
      .readSkillContent(variant.instructionFile)
      .then((result) => {
        if (!ignoreResult) {
          setContentResult(result);
        }
      })
      .catch((error: unknown) => {
        if (!ignoreResult) {
          setContentResult({
            ok: false,
            error: error instanceof Error ? error.message : "The skill file could not be read.",
          });
        }
      });

    return () => {
      ignoreResult = true;
    };
  }, [activeTab, canReadContent, variant.instructionFile]);

  return (
    <div className="detail-content" ref={detailRef}>
      <div className="detail-heading">
        <span className="capability-detail-mark">
          <MarkIcon />
        </span>
        <div>
          <p>Skill block</p>
          <h3>{capability.name}</h3>
        </div>
      </div>

      {change && <ChangeNotice change={change} />}

      <CapabilityCoverage capability={capability} />

      <SkillVariantSelector
        capability={capability}
        selectedVariant={variant}
        onSelect={setSelectedVariantId}
      />

      <div
        className={`detail-tabs${canReadContent ? "" : " overview-only"}`}
        role="tablist"
        aria-label="Skill detail view"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "overview"}
          className={activeTab === "overview" ? "active" : ""}
          onClick={() => setActiveTab("overview")}
        >
          Overview
        </button>
        {canReadContent && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "contents"}
            className={activeTab === "contents" ? "active" : ""}
            onClick={() => setActiveTab("contents")}
          >
            Contents
          </button>
        )}
      </div>

      {activeTab === "overview" ? (
        <SkillOverview skill={skill} />
      ) : (
        <SkillContents result={contentResult} />
      )}
    </div>
  );
}

function SkillVariantSelector({
  capability,
  selectedVariant,
  onSelect,
}: {
  capability: SkillCapabilityGroup;
  selectedVariant: SkillVariantGroup;
  onSelect: (id: string) => void;
}) {
  const [showDiff, setShowDiff] = useState(false);
  const [comparisonId, setComparisonId] = useState(
    capability.variants.find((variant) => variant.id !== selectedVariant.id)?.id ?? "",
  );
  const comparisonVariant =
    capability.variants.find(
      (variant) => variant.id === comparisonId && variant.id !== selectedVariant.id,
    ) ?? capability.variants.find((variant) => variant.id !== selectedVariant.id);

  return (
    <section className="variant-section" aria-label="Skill variants">
      <div className="variant-section-heading">
        <div>
          <span>Local definitions</span>
          <strong>
            {capability.variants.length === 1
              ? "One shared variant"
              : `${capability.variants.length} variants found`}
          </strong>
        </div>
        {capability.variants.length > 1 && (
          <div className="variant-switch" role="tablist" aria-label="Choose skill variant">
            {capability.variants.map((variant, index) => (
              <button
                key={variant.id}
                type="button"
                role="tab"
                aria-selected={variant.id === selectedVariant.id}
                className={variant.id === selectedVariant.id ? "active" : ""}
                onClick={() => onSelect(variant.id)}
              >
                Variant {index + 1}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="variant-connections">
        {selectedVariant.definitions.map((definition) => (
          <div className="variant-connection" key={getSkillIdentity(definition)}>
            <span className={`connection-dot connection-${definition.application}`} />
            <div>
              <strong>{definition.applicationName}</strong>
              <span>{definition.projectName ?? definition.sourceName}</span>
            </div>
          </div>
        ))}
      </div>
      <code className="variant-path">{shortenPath(selectedVariant.instructionFile)}</code>

      {capability.variants.length > 1 && comparisonVariant && (
        <div className="variant-compare">
          <div className="variant-compare-actions">
            <button
              type="button"
              className={`compare-toggle${showDiff ? " active" : ""}`}
              aria-expanded={showDiff}
              onClick={() => setShowDiff((current) => !current)}
            >
              {showDiff ? "Hide comparison" : "Compare variants"}
            </button>
            {showDiff && capability.variants.length > 2 && (
              <label className="compare-select">
                <span>Compare with</span>
                <select
                  value={comparisonVariant.id}
                  onChange={(event) => setComparisonId(event.target.value)}
                >
                  {capability.variants
                    .filter((variant) => variant.id !== selectedVariant.id)
                    .map((variant) => (
                      <option key={variant.id} value={variant.id}>
                        {getVariantLabel(capability, variant)}
                      </option>
                    ))}
                </select>
              </label>
            )}
          </div>
          {showDiff && (
            <VariantDiffPanel
              capability={capability}
              leftVariant={selectedVariant}
              rightVariant={comparisonVariant}
            />
          )}
        </div>
      )}
    </section>
  );
}

type VariantDiffState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; diff: TextDiffResult; sourceTruncated: boolean };

function VariantDiffPanel({
  capability,
  leftVariant,
  rightVariant,
}: {
  capability: SkillCapabilityGroup;
  leftVariant: SkillVariantGroup;
  rightVariant: SkillVariantGroup;
}) {
  const [state, setState] = useState<VariantDiffState>({ status: "loading" });

  useEffect(() => {
    let ignoreResult = false;
    setState({ status: "loading" });

    void Promise.all([
      window.skillManager.readSkillContent(leftVariant.instructionFile),
      window.skillManager.readSkillContent(rightVariant.instructionFile),
    ])
      .then(([left, right]) => {
        if (ignoreResult) return;
        if (!left.ok || !right.ok) {
          setState({
            status: "error",
            message: !left.ok
              ? left.error
              : !right.ok
                ? right.error
                : "The variants could not be read.",
          });
          return;
        }
        setState({
          status: "ready",
          diff: createTextDiff(left.content, right.content),
          sourceTruncated: left.truncated || right.truncated,
        });
      })
      .catch((error: unknown) => {
        if (!ignoreResult) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "The variants could not be compared.",
          });
        }
      });

    return () => {
      ignoreResult = true;
    };
  }, [leftVariant.instructionFile, rightVariant.instructionFile]);

  if (state.status === "loading") {
    return (
      <div className="diff-message" role="status">
        <RefreshIcon className="spinning" /> Comparing local files…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="diff-message diff-error" role="alert">
        <AlertIcon /> {state.message}
      </div>
    );
  }

  const leftLabel = getVariantLabel(capability, leftVariant);
  const rightLabel = getVariantLabel(capability, rightVariant);
  const isBounded = state.diff.truncated || state.sourceTruncated;

  return (
    <section
      className="variant-diff-panel"
      aria-label={`${leftLabel} and ${rightLabel} differences`}
    >
      <div className="diff-heading">
        <div>
          <strong>{leftLabel}</strong>
          <span>compared with</span>
          <strong>{rightLabel}</strong>
        </div>
        <div className="diff-totals" aria-label="Difference totals">
          <span className="diff-removed-total">−{state.diff.removed}</span>
          <span className="diff-added-total">+{state.diff.added}</span>
        </div>
      </div>

      {state.diff.identical ? (
        <div className="diff-identical">These variants have identical contents.</div>
      ) : (
        <div className="diff-lines" role="table" aria-label="Line differences">
          {state.diff.lines.map((line, index) =>
            line.type === "skipped" ? (
              <div className="diff-skipped" key={`skip:${index}`} role="row">
                {line.content}
              </div>
            ) : (
              <div
                className={`diff-line diff-line-${line.type}`}
                key={`${line.type}:${index}`}
                role="row"
              >
                <span className="diff-line-number">{line.oldLine ?? ""}</span>
                <span className="diff-line-number">{line.newLine ?? ""}</span>
                <span className="diff-symbol">
                  {line.type === "added" ? "+" : line.type === "removed" ? "−" : ""}
                </span>
                <code>{line.content || " "}</code>
              </div>
            ),
          )}
        </div>
      )}

      {isBounded && (
        <p className="diff-notice">Comparison limited to the first 800 lines of each preview.</p>
      )}
    </section>
  );
}

function ChangeNotice({ change }: { change: SkillChange }) {
  const message =
    change.type === "added"
      ? "This skill was added after the previous scan."
      : change.type === "modified"
        ? "The SKILL.md contents changed after the previous scan."
        : change.type === "removed"
          ? "This skill was removed. Its last known metadata is shown below."
          : `Moved from ${shortenPath(change.previousSkill?.directory ?? "an earlier location")}.`;

  return (
    <div className={`change-notice change-notice-${change.type}`}>
      <ChangePill type={change.type} />
      <span>{message}</span>
    </div>
  );
}

function SkillOverview({ skill }: { skill: DiscoveredSkill }) {
  return (
    <>
      <p className="detail-description">
        {skill.description ?? "This skill does not provide a description."}
      </p>

      <dl className="detail-list">
        <div>
          <dt>Source</dt>
          <dd>{skill.sourceName}</dd>
        </div>
        <div>
          <dt>Availability</dt>
          <dd>{skill.projectName ? `Project: ${skill.projectName}` : "Global"}</dd>
        </div>
        <div>
          <dt>Metadata</dt>
          <dd>
            <StatusPill status={skill.metadataStatus} />
          </dd>
        </div>
        <div>
          <dt>Folder</dt>
          <dd>{skill.folderName}</dd>
        </div>
        <div>
          <dt>Modified</dt>
          <dd>{formatDate(skill.modifiedAt)}</dd>
        </div>
      </dl>

      {skill.metadataIssues.length > 0 && (
        <div className="issues-box">
          <strong>Metadata notes</strong>
          <ul>
            {skill.metadataIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="location-block">
        <span>
          <FolderIcon /> Local location
        </span>
        <code>{shortenPath(skill.directory)}</code>
      </div>

      {skill.projectRoot && (
        <div className="location-block">
          <span>
            <FolderIcon /> Project root
          </span>
          <code>{shortenPath(skill.projectRoot)}</code>
        </div>
      )}
    </>
  );
}

function SkillContents({ result }: { result: SkillContentResult | null }) {
  const [contentView, setContentView] = useState<ContentView>("rendered");

  if (!result) {
    return (
      <div className="content-message" role="status">
        <RefreshIcon className="spinning" />
        Reading SKILL.md…
      </div>
    );
  }

  if (!result.ok) {
    return (
      <div className="content-message content-error" role="alert">
        <AlertIcon />
        <span>{result.error}</span>
      </div>
    );
  }

  return (
    <section className="skill-contents" aria-label="SKILL.md contents">
      <div className="content-heading">
        <div>
          <strong>SKILL.md</strong>
          <span>Local, read-only preview</span>
        </div>
        <div className="content-mode-switch" aria-label="Content display mode">
          <button
            type="button"
            className={contentView === "rendered" ? "active" : ""}
            aria-pressed={contentView === "rendered"}
            onClick={() => setContentView("rendered")}
          >
            Rendered
          </button>
          <button
            type="button"
            className={contentView === "source" ? "active" : ""}
            aria-pressed={contentView === "source"}
            onClick={() => setContentView("source")}
          >
            Source
          </button>
        </div>
      </div>
      {result.truncated && (
        <p className="content-notice">
          This preview shows the first 512 KB because the file is unusually large.
        </p>
      )}
      {contentView === "rendered" ? (
        <div className="markdown-body">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ children, href, ...properties }) => (
                <a
                  {...properties}
                  href={href}
                  title={href}
                  onClick={(event) => event.preventDefault()}
                >
                  {children}
                </a>
              ),
              img: ({ alt }) => (
                <span className="markdown-image-placeholder">
                  Image omitted{alt ? `: ${alt}` : ""}
                </span>
              ),
            }}
          >
            {getRenderableMarkdown(result.content) || "*This file is empty.*"}
          </ReactMarkdown>
        </div>
      ) : (
        <pre className="skill-content-code">{result.content || "This file is empty."}</pre>
      )}
    </section>
  );
}

function StatusPill({ status }: { status: MetadataStatus }) {
  return <span className={`status-pill status-${status}`}>{capitalize(status)}</span>;
}

function ChangePill({ type }: { type: SkillChangeType }) {
  return <span className={`change-pill change-${type}`}>{changeLabel(type)}</span>;
}

function LoadingList() {
  return (
    <div className="loading-list" aria-label="Scanning local skills">
      {[1, 2, 3, 4].map((item) => (
        <div className="loading-row" key={item} />
      ))}
    </div>
  );
}

function EmptyInventory({
  mode,
  hasActiveFilters,
  onClear,
}: {
  mode: InventoryMode;
  hasActiveFilters: boolean;
  onClear: () => void;
}) {
  const noChanges = mode === "changes" && !hasActiveFilters;

  return (
    <div className="empty-state">
      <SearchIcon />
      <h3>{noChanges ? "No changes detected" : "No matching skills"}</h3>
      <p>
        {noChanges
          ? "Your local skills match the previous scan. Rescan after making a change to compare again."
          : "Try clearing the filters or searching for something else."}
      </p>
      {hasActiveFilters && (
        <button type="button" onClick={onClear}>
          Clear filters
        </button>
      )}
    </div>
  );
}

function EmptyDetails() {
  return (
    <div className="empty-details">
      <MarkIcon />
      <h3>Select a skill</h3>
      <p>Its description, source, metadata, and local location will appear here.</p>
    </div>
  );
}

function findSkillCapabilityGroup(
  groups: readonly SkillCapabilityGroup[],
  skill: DiscoveredSkill,
): SkillCapabilityGroup | null {
  const identity = getSkillIdentity(skill);
  return (
    groups.find((group) =>
      group.definitions.some((definition) => getSkillIdentity(definition) === identity),
    ) ?? null
  );
}

function findMcpCapabilityGroup(
  groups: readonly McpCapabilityGroup[],
  server: DiscoveredMcpServer,
): McpCapabilityGroup | null {
  const identity = getMcpServerIdentity(server);
  return (
    groups.find((group) =>
      group.definitions.some((definition) => getMcpServerIdentity(definition) === identity),
    ) ?? null
  );
}

function applicationLabel(application: "chatgpt" | "claude"): string {
  return application === "chatgpt" ? "ChatGPT" : "Claude";
}

function getVariantRepresentative(variant: SkillVariantGroup): DiscoveredSkill {
  return (
    variant.definitions.find((definition) => definition.metadataStatus === "valid") ??
    variant.definitions[0]
  );
}

function getVariantLabel(capability: SkillCapabilityGroup, variant: SkillVariantGroup): string {
  return `Variant ${capability.variants.findIndex((item) => item.id === variant.id) + 1}`;
}

function getCapabilityMetadataStatus(capability: SkillCapabilityGroup): MetadataStatus {
  const priority: MetadataStatus[] = ["unreadable", "invalid", "missing", "incomplete", "valid"];
  for (const status of priority) {
    if (capability.definitions.some((definition) => definition.metadataStatus === status)) {
      return status;
    }
  }
  return "valid";
}

function countChanges(changes: readonly SkillChange[]): Record<SkillChangeType, number> {
  const counts: Record<SkillChangeType, number> = {
    added: 0,
    modified: 0,
    moved: 0,
    removed: 0,
  };

  for (const change of changes) {
    counts[change.type] += 1;
  }

  return counts;
}

function changeLabel(type: SkillChangeType): string {
  return type === "moved" ? "Moved" : capitalize(type);
}

function getProjectOptions(
  skills: readonly DiscoveredSkill[],
  application: ApplicationChoice,
): Array<{ id: string; name: string }> {
  const projects = new Map<string, { applicationName: string; name: string }>();

  for (const skill of skills) {
    if (
      skill.projectId &&
      skill.projectName &&
      (application === "all" || skill.application === application)
    ) {
      projects.set(skill.projectId, {
        applicationName: skill.applicationName,
        name: skill.projectName,
      });
    }
  }

  const duplicateNames = new Map<string, number>();
  for (const project of projects.values()) {
    duplicateNames.set(project.name, (duplicateNames.get(project.name) ?? 0) + 1);
  }

  return [...projects.entries()]
    .map(([id, project]) => ({
      id,
      name:
        application === "all" && (duplicateNames.get(project.name) ?? 0) > 1
          ? `${project.name} — ${project.applicationName}`
          : project.name,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
}

function getMcpProjectOptions(
  servers: readonly DiscoveredMcpServer[],
  application: ApplicationChoice,
): Array<{ id: string; name: string }> {
  const projects = new Map<string, { applicationName: string; name: string }>();
  for (const server of servers) {
    if (
      server.projectId &&
      server.projectName &&
      (application === "all" || server.application === application)
    ) {
      projects.set(server.projectId, {
        applicationName: server.applicationName,
        name: server.projectName,
      });
    }
  }

  const duplicateNames = new Map<string, number>();
  for (const item of projects.values()) {
    duplicateNames.set(item.name, (duplicateNames.get(item.name) ?? 0) + 1);
  }

  return [...projects.entries()]
    .map(([id, item]) => ({
      id,
      name:
        application === "all" && (duplicateNames.get(item.name) ?? 0) > 1
          ? `${item.name} — ${item.applicationName}`
          : item.name,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
}

function getPluginProjectOptions(
  plugins: readonly DiscoveredPlugin[],
  application: ApplicationChoice,
): Array<{ id: string; name: string }> {
  const projects = new Map<string, { applicationName: string; name: string }>();
  for (const plugin of plugins) {
    if (
      plugin.projectId &&
      plugin.projectName &&
      (application === "all" || plugin.application === application)
    ) {
      projects.set(plugin.projectId, {
        applicationName: plugin.applicationName,
        name: plugin.projectName,
      });
    }
  }

  const duplicateNames = new Map<string, number>();
  for (const item of projects.values()) {
    duplicateNames.set(item.name, (duplicateNames.get(item.name) ?? 0) + 1);
  }

  return [...projects.entries()]
    .map(([id, item]) => ({
      id,
      name:
        application === "all" && (duplicateNames.get(item.name) ?? 0) > 1
          ? `${item.name} — ${item.applicationName}`
          : item.name,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
}

function formatDate(value: string | null): string {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() <= 1970) {
    return "Not available";
  }

  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    date,
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
    new Date(value),
  );
}

function shortenPath(value: string): string {
  return value.replace(/^\/Users\/[^/]+/, "~");
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

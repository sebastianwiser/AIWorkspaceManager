import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createInventoryView, getSkillIdentity } from "../../inventory.js";
import { getRenderableMarkdown } from "../../markdown.js";
import type {
  ApplicationChoice,
  DesktopScanResult,
  DiscoveredSkill,
  InventorySortField,
  MetadataStatus,
  SkillChange,
  SkillChangeType,
  SkillContentResult,
  SkillSourceId,
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
  const [query, setQuery] = useState("");
  const [application, setApplication] = useState<ApplicationChoice>("all");
  const [source, setSource] = useState<SourceFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [changeType, setChangeType] = useState<ChangeFilter>("all");
  const [project, setProject] = useState<ProjectFilter>("all");
  const [sortBy, setSortBy] = useState<InventorySortField>("name");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);

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
  const sourceSkills = useMemo(
    () =>
      mode === "inventory"
        ? allSkills
        : allChanges
            .filter((change) => changeType === "all" || change.type === changeType)
            .map((change) => change.skill),
    [allChanges, allSkills, changeType, mode],
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

  useEffect(() => {
    if (inventory.length === 0) {
      setSelectedSkillId(null);
      return;
    }

    if (!inventory.some((skill) => getSkillIdentity(skill) === selectedSkillId)) {
      setSelectedSkillId(getSkillIdentity(inventory[0]));
    }
  }, [inventory, selectedSkillId]);

  const selectedSkill =
    inventory.find((skill) => getSkillIdentity(skill) === selectedSkillId) ?? inventory[0] ?? null;
  const selectedChange =
    mode === "changes" && selectedSkill
      ? (allChanges.find(
          (change) => getSkillIdentity(change.skill) === getSkillIdentity(selectedSkill),
        ) ?? null)
      : null;
  const chatGptCount = allSkills.filter((skill) => skill.application === "chatgpt").length;
  const claudeCount = allSkills.filter((skill) => skill.application === "claude").length;
  const attentionCount = allSkills.filter((skill) => skill.metadataStatus !== "valid").length;
  const warningCount =
    scanResult?.diagnostics.filter((item) => item.severity === "warning").length ?? 0;
  const missingLocationCount =
    scanResult?.diagnostics.filter((item) => item.code === "LOCATION_NOT_FOUND").length ?? 0;
  const variantCounts = useMemo(() => countVariants(inventory), [inventory]);
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
        <section className="intro-row" aria-labelledby="inventory-heading">
          <div>
            <p className="section-kicker">SKILL LIBRARY</p>
            <h2 id="inventory-heading">Everything installed, in one place.</h2>
            <p>Browse the local skills available to ChatGPT and Claude without changing a file.</p>
          </div>
          {scanResult && (
            <p className="scan-time">
              Last scanned{" "}
              <time dateTime={scanResult.scannedAt}>{formatTime(scanResult.scannedAt)}</time>
            </p>
          )}
        </section>

        <section className="stats-grid" aria-label="Inventory summary">
          <StatCard label="Total definitions" value={allSkills.length} tone="ink" />
          <StatCard label="ChatGPT" value={chatGptCount} tone="green" />
          <StatCard label="Claude" value={claudeCount} tone="orange" />
          <StatCard label="Needs attention" value={attentionCount} tone="yellow" />
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
              <strong>{inventory.length}</strong> of{" "}
              {mode === "inventory" ? allSkills.length : allChanges.length}{" "}
              {mode === "inventory" ? "definitions" : "changes"}
            </span>
            {missingLocationCount > 0 && (
              <span>{missingLocationCount} optional locations not present</span>
            )}
          </div>

          <div className="inventory-layout">
            <div className="skill-list" aria-label="Skills">
              {isScanning && !scanResult ? (
                <LoadingList />
              ) : inventory.length > 0 ? (
                inventory.map((skill) => (
                  <SkillRow
                    key={getSkillIdentity(skill)}
                    skill={skill}
                    selected={getSkillIdentity(skill) === selectedSkillId}
                    variantCount={variantCounts.get(variantKey(skill)) ?? 1}
                    change={
                      mode === "changes"
                        ? (allChanges.find(
                            (item) => getSkillIdentity(item.skill) === getSkillIdentity(skill),
                          ) ?? null)
                        : null
                    }
                    onSelect={() => setSelectedSkillId(getSkillIdentity(skill))}
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
              {selectedSkill ? (
                <SkillDetails
                  key={`${getSkillIdentity(selectedSkill)}:${selectedChange?.type ?? "inventory"}`}
                  skill={selectedSkill}
                  change={selectedChange}
                />
              ) : (
                <EmptyDetails />
              )}
            </aside>
          </div>
        </section>
      </main>

      <footer>
        <ShieldIcon />
        Local-only discovery · No skill files are executed or changed
      </footer>
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

function StatCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <article className={`stat-card stat-${tone}`}>
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

function SkillRow({
  skill,
  selected,
  variantCount,
  change,
  onSelect,
}: {
  skill: DiscoveredSkill;
  selected: boolean;
  variantCount: number;
  change: SkillChange | null;
  onSelect: () => void;
}) {
  return (
    <button className={`skill-row${selected ? " selected" : ""}`} type="button" onClick={onSelect}>
      <span className={`app-monogram app-${skill.application}`}>
        {skill.application === "chatgpt" ? "G" : "C"}
      </span>
      <span className="skill-row-copy">
        <span className="skill-name-line">
          <strong>{skill.name}</strong>
          {variantCount > 1 && <span className="variant-badge">{variantCount} variants</span>}
        </span>
        <span>{skill.description ?? "No description provided."}</span>
        <span className="row-meta">
          {skill.applicationName} · {skill.projectName ?? skill.sourceName}
        </span>
      </span>
      <span className="row-status">
        {change && <ChangePill type={change.type} />}
        <StatusPill status={skill.metadataStatus} />
      </span>
    </button>
  );
}

function SkillDetails({ skill, change }: { skill: DiscoveredSkill; change: SkillChange | null }) {
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [contentResult, setContentResult] = useState<SkillContentResult | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const canReadContent = change?.type !== "removed";

  useEffect(() => {
    detailRef.current?.scrollTo({ top: 0 });
  }, [activeTab, skill.instructionFile]);

  useEffect(() => {
    if (activeTab !== "contents" || !canReadContent) {
      return;
    }

    let ignoreResult = false;
    setContentResult(null);

    void window.skillManager
      .readSkillContent(skill.instructionFile)
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
  }, [activeTab, canReadContent, skill.instructionFile]);

  return (
    <div className="detail-content" ref={detailRef}>
      <div className="detail-heading">
        <span className={`app-monogram app-${skill.application}`}>
          {skill.application === "chatgpt" ? "G" : "C"}
        </span>
        <div>
          <p>{skill.applicationName}</p>
          <h3>{skill.name}</h3>
        </div>
      </div>

      {change && <ChangeNotice change={change} />}

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

function variantKey(skill: DiscoveredSkill): string {
  return `${skill.application}:${skill.name.toLocaleLowerCase()}`;
}

function countVariants(skills: DiscoveredSkill[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const skill of skills) {
    const key = variantKey(skill);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
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

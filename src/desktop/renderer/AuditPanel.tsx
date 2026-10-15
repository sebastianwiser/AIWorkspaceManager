import { useState } from "react";
import type {
  ApplicationChoice,
  AuditFamily,
  AuditFinding,
  DesktopScanResult,
} from "../../types.js";
import { AlertIcon, SearchIcon, ShieldIcon } from "./Icons.js";

const familyLabels: Record<AuditFamily, string> = {
  structure: "Structure",
  exposure: "Exposure",
  commands: "Commands",
  provenance: "Provenance",
};

export function AuditPanel({
  scanResult,
  isScanning,
  error,
  onRetry,
  onInspect,
}: {
  scanResult: DesktopScanResult | null;
  isScanning: boolean;
  error: string | null;
  onRetry: () => void;
  onInspect: (finding: AuditFinding) => void;
}) {
  const [query, setQuery] = useState("");
  const [application, setApplication] = useState<ApplicationChoice>("all");
  const [family, setFamily] = useState<AuditFamily | "all">("all");
  const [severity, setSeverity] = useState<AuditFinding["severity"] | "all">("all");
  const report = scanResult?.audit;
  const findings = report?.findings ?? [];
  const coverage = report?.coverage ?? [];
  const search = query.trim().toLocaleLowerCase();
  const visible = findings.filter(
    (finding) =>
      (application === "all" || finding.application === application) &&
      (family === "all" || finding.family === family) &&
      (severity === "all" || finding.severity === severity) &&
      (search === "" ||
        [finding.title, finding.ruleId, finding.sourceFile, finding.explanation]
          .join("\n")
          .toLocaleLowerCase()
          .includes(search)),
  );
  const incomplete = coverage.filter((item) => item.status !== "evaluated");
  const hasFilters =
    search !== "" || application !== "all" || family !== "all" || severity !== "all";
  const uniqueFiles = new Set(report?.files?.map((item) => item.sourceFile) ?? []);
  const scriptFiles = new Set(
    report?.files?.filter((item) => item.isScript).map((item) => item.sourceFile) ?? [],
  );

  return (
    <>
      <section className="intro-row" aria-labelledby="audit-heading">
        <div>
          <p className="section-kicker">WORKSPACE AUDIT</p>
          <h2 id="audit-heading">Know what needs a closer look.</h2>
          <p>
            Review local structure, exposure, commands, and provenance without running anything.
          </p>
        </div>
        {scanResult && (
          <p className="scan-time">
            Last scanned{" "}
            <time dateTime={scanResult.scannedAt}>
              {new Date(scanResult.scannedAt).toLocaleString()}
            </time>
          </p>
        )}
      </section>

      {report?.fileChangeTrackingError && (
        <div className="message error-message" role="alert">
          <AlertIcon />
          <span>{report.fileChangeTrackingError}</span>
        </div>
      )}

      {report?.fileChanges && report.fileChanges.length > 0 && (
        <section className="audit-changes" aria-label="Changed audited files">
          <strong>{report.fileChanges.length} audited files changed since the previous scan</strong>
          <ul>
            {report.fileChanges.slice(0, 8).map((change) => (
              <li key={`${change.type}:${change.file.itemId}:${change.file.sourceFile}`}>
                <span>{change.type}</span>
                <code>{change.file.sourceFile}</code>
              </li>
            ))}
          </ul>
          {report.fileChanges.length > 8 && <p>Showing the first 8 changes.</p>}
        </section>
      )}

      <section className="summary-strip" aria-label="Audit summary">
        <AuditMetric label="Findings" value={findings.length} />
        <AuditMetric label="Files inspected" value={uniqueFiles.size} />
        <AuditMetric
          label="Warnings"
          value={findings.filter((item) => item.severity === "warning").length}
        />
        <AuditMetric
          label="To review"
          value={findings.filter((item) => item.confidence === "possible").length}
        />
        <AuditMetric label="Partial checks" value={incomplete.length} />
      </section>

      {scanResult && (
        <section className="audit-access" aria-labelledby="audit-access-heading">
          <div>
            <p className="section-kicker">POTENTIAL ACCESS</p>
            <h3 id="audit-access-heading">What these components may do</h3>
            <p>
              Based on local declarations and file types. This does not verify runtime permissions.
            </p>
          </div>
          <div className="audit-access-grid">
            <AuditAccessFact
              label="Local server commands"
              value={scanResult.mcpServers.filter((item) => item.transport === "stdio").length}
              detail="May launch when an AI app connects"
            />
            <AuditAccessFact
              label="Network endpoints"
              value={
                scanResult.mcpServers.filter(
                  (item) => item.transport === "http" || item.transport === "sse",
                ).length
              }
              detail="May send data to a configured server"
            />
            <AuditAccessFact
              label="Plugin hooks"
              value={scanResult.plugins.filter((item) => item.hasHooks).length}
              detail="May run at app lifecycle events"
            />
            <AuditAccessFact
              label="Script files"
              value={scriptFiles.size}
              detail="Found in inspected bundles; not run here"
            />
          </div>
        </section>
      )}

      {error && (
        <div className="message error-message" role="alert">
          <AlertIcon />
          <div>
            <strong>The local audit could not be refreshed.</strong>
            <span>{error}</span>
          </div>
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
      {report && incomplete.length > 0 && (
        <div className="message warning-message" role="status">
          <AlertIcon />
          <div>
            <strong>Some checks are incomplete.</strong>
            <span>
              {incomplete.length} application and category checks could not fully inspect their
              sources. Missing findings in those areas do not mean they are safe.
            </span>
          </div>
        </div>
      )}

      <section className="inventory-card audit-card" aria-label="Audit findings">
        <div className="audit-toolbar">
          <label className="search-control">
            <span className="visually-hidden">Search audit findings</span>
            <SearchIcon />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search findings or locations"
            />
          </label>
          <label className="audit-select">
            <span>Application</span>
            <select
              value={application}
              onChange={(event) => setApplication(event.target.value as ApplicationChoice)}
            >
              <option value="all">All applications</option>
              <option value="chatgpt">ChatGPT</option>
              <option value="claude">Claude</option>
            </select>
          </label>
          <label className="audit-select">
            <span>Category</span>
            <select
              value={family}
              onChange={(event) => setFamily(event.target.value as AuditFamily | "all")}
            >
              <option value="all">All categories</option>
              {Object.entries(familyLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="audit-select">
            <span>Severity</span>
            <select
              value={severity}
              onChange={(event) =>
                setSeverity(event.target.value as AuditFinding["severity"] | "all")
              }
            >
              <option value="all">All levels</option>
              <option value="critical">Critical</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
            </select>
          </label>
        </div>
        <div className="inventory-meta">
          <span>
            <strong>{visible.length}</strong> of {findings.length} findings
          </span>
          <span>Static evidence only · no checks execute discovered code</span>
        </div>
        <div className="audit-body">
          {isScanning && !scanResult ? (
            <div className="audit-empty" role="status">
              Checking the local inventory…
            </div>
          ) : visible.length > 0 ? (
            <div className="audit-grid">
              {visible.map((finding) => (
                <FindingCard key={finding.id} finding={finding} onInspect={onInspect} />
              ))}
            </div>
          ) : (
            <div className="audit-empty">
              <ShieldIcon />
              <strong>
                {hasFilters
                  ? "No findings match these filters"
                  : "No findings from the supported checks"}
              </strong>
              <p>
                {hasFilters
                  ? "Try a different category, application, or search."
                  : "This is not a safety guarantee. Static rules cannot verify runtime behavior or every possible risk."}
              </p>
            </div>
          )}
        </div>
      </section>

      {report && (
        <section className="audit-coverage" aria-labelledby="audit-coverage-heading">
          <div>
            <p className="section-kicker">CHECK COVERAGE</p>
            <h3 id="audit-coverage-heading">What was evaluated</h3>
          </div>
          <div className="audit-coverage-grid">
            {coverage.map((item) => (
              <div className="audit-coverage-row" key={`${item.application}:${item.family}`}>
                <span>
                  {item.application === "chatgpt" ? "ChatGPT" : "Claude"} ·{" "}
                  {familyLabels[item.family]}
                </span>
                <strong className={`audit-coverage-status ${item.status}`}>
                  {item.status.replace("-", " ")}
                </strong>
              </div>
            ))}
          </div>
          <p className="audit-disclaimer">
            Evaluated means the supported static rules ran on available sources—not that every risk
            was ruled out. Incomplete sources remain unknown until they can be inspected.
          </p>
        </section>
      )}
    </>
  );
}

function AuditMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="summary-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AuditAccessFact({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="audit-access-fact">
      <strong>{value}</strong>
      <span>{label}</span>
      <small>{detail}</small>
    </div>
  );
}

function FindingCard({
  finding,
  onInspect,
}: {
  finding: AuditFinding;
  onInspect: (finding: AuditFinding) => void;
}) {
  return (
    <article className={`audit-finding ${finding.severity}`}>
      <div className="audit-finding-top">
        <span className={`audit-severity ${finding.severity}`}>{finding.severity}</span>
        <span>
          {familyLabels[finding.family]} · {finding.confidence}
        </span>
      </div>
      <h3>{finding.title}</h3>
      <p>{finding.explanation}</p>
      <p className="audit-evidence">{finding.evidence}</p>
      <div className="audit-source">
        <span>{finding.application === "chatgpt" ? "ChatGPT" : "Claude"}</span>
        <code title={finding.sourceFile}>
          {finding.sourceFile}
          {finding.line ? `:${finding.line}` : ""}
        </code>
      </div>
      <div className="audit-finding-footer">
        <span>
          <strong>Next:</strong> {finding.remedy}
        </span>
        {finding.itemKind !== "source" && finding.itemIds.length > 0 && (
          <button type="button" onClick={() => onInspect(finding)}>
            View item
          </button>
        )}
      </div>
    </article>
  );
}

import { useMemo, useState } from "react";
import { createRelationshipMap, getRelationshipScopeId } from "../../relationships.js";
import type { RelationshipPlugin, RelationshipScope } from "../../relationships.js";
import type {
  ApplicationChoice,
  DesktopScanResult,
  McpCapabilityGroup,
  SkillCapabilityGroup,
} from "../../types.js";
import { AlertIcon, SearchIcon } from "./Icons.js";

export function RelationshipPanel({
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
  const [application, setApplication] = useState<ApplicationChoice>("all");
  const [location, setLocation] = useState("all");
  const [query, setQuery] = useState("");
  const map = useMemo(() => (scanResult ? createRelationshipMap(scanResult) : null), [scanResult]);
  const availableScopes = useMemo(
    () =>
      map?.scopes.filter((scope) => application === "all" || scope.application === application) ??
      [],
    [application, map],
  );
  const matchingLocation = availableScopes.some((scope) => scope.id === location)
    ? location
    : "all";
  const selectedScope = availableScopes.find((scope) => scope.id === matchingLocation);
  const search = query.trim().toLocaleLowerCase();
  const visibleScopes = availableScopes
    .filter((scope) => matchingLocation === "all" || scope.id === matchingLocation)
    .map((scope) => filterScope(scope, search))
    .filter((scope): scope is RelationshipScope => scope !== null);
  const connections = [...(map?.skillConnections ?? []), ...(map?.mcpConnections ?? [])].filter(
    (group) =>
      (application === "all" || group.applications.includes(application)) &&
      (!selectedScope ||
        group.definitions.some(
          (definition) => getRelationshipScopeId(definition) === selectedScope.id,
        )) &&
      (search === "" || group.name.toLocaleLowerCase().includes(search)),
  );
  const pluginCount = map?.scopes.reduce((sum, scope) => sum + scope.plugins.length, 0) ?? 0;
  const projectCount = map?.scopes.filter((scope) => scope.scope === "project").length ?? 0;

  return (
    <>
      <section className="intro-row" aria-labelledby="relationship-heading">
        <div>
          <p className="section-kicker">WORKSPACE MAP</p>
          <h2 id="relationship-heading">See how the pieces fit together.</h2>
          <p>
            Follow each application into its global and project locations, then into plugins,
            skills, and configured MCP servers.
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

      <section className="summary-strip relationship-summary" aria-label="Relationship summary">
        <RelationshipMetric label="Locations" value={map?.scopes.length ?? 0} />
        <RelationshipMetric label="Project scopes" value={projectCount} />
        <RelationshipMetric label="Plugins" value={pluginCount} />
        <RelationshipMetric
          label="Cross-app links"
          value={(map?.skillConnections.length ?? 0) + (map?.mcpConnections.length ?? 0)}
        />
      </section>

      {error && (
        <div className="message error-message" role="alert">
          <AlertIcon />
          <div>
            <strong>The relationship map could not be refreshed.</strong>
            <span>{error}</span>
          </div>
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
      {!error && scanResult?.diagnostics.some((item) => item.severity === "warning") && (
        <div className="message warning-message" role="status">
          <AlertIcon />
          <span>Some locations could not be fully scanned. Connections may be incomplete.</span>
        </div>
      )}

      <section className="inventory-card relationship-card" aria-label="Application relationships">
        <div className="relationship-controls">
          <label className="search-control">
            <span className="visually-hidden">Search the workspace map</span>
            <SearchIcon />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search projects, plugins, skills, or MCP servers"
            />
          </label>
          <label className="relationship-select">
            <span>Application</span>
            <select
              value={application}
              onChange={(event) => {
                setApplication(event.target.value as ApplicationChoice);
                setLocation("all");
              }}
            >
              <option value="all">All applications</option>
              <option value="chatgpt">ChatGPT</option>
              <option value="claude">Claude</option>
            </select>
          </label>
          <label className="relationship-select">
            <span>Location</span>
            <select value={matchingLocation} onChange={(event) => setLocation(event.target.value)}>
              <option value="all">All locations</option>
              {availableScopes.map((scope) => (
                <option key={scope.id} value={scope.id}>
                  {scope.applicationName} ·{" "}
                  {scope.scope === "global" ? "Global" : (scope.projectName ?? "Project")}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="relationship-key">
          <span>
            <i className="relationship-dot plugin-dot" /> Plugin bundle
          </span>
          <span>
            <i className="relationship-dot skill-dot" /> Skill definition
          </span>
          <span>
            <i className="relationship-dot mcp-dot" /> Configured MCP
          </span>
          <span>
            <i className="relationship-dot packaged-dot" /> Packaged only
          </span>
        </div>
        <div className="relationship-body">
          {isScanning && !scanResult ? (
            <div className="relationship-empty" role="status">
              Building the local workspace map…
            </div>
          ) : visibleScopes.length > 0 ? (
            visibleScopes.map((scope) => <ScopeCard key={scope.id} scope={scope} />)
          ) : (
            <div className="relationship-empty">
              <strong>
                {map?.scopes.length ? "No locations match" : "No local relationships found"}
              </strong>
              <p>
                {map?.scopes.length
                  ? "Try another application, location, or search."
                  : "Rescan after adding a supported skill, plugin, or MCP configuration."}
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="relationship-connections" aria-labelledby="cross-app-heading">
        <div className="relationship-section-heading">
          <div>
            <p className="section-kicker">CROSS-APP IDENTITY</p>
            <h3 id="cross-app-heading">Shared capabilities and candidates</h3>
          </div>
          <span>{connections.length} visible</span>
        </div>
        <p className="relationship-explainer">
          A shared file or exact endpoint is strong local evidence. A matching name alone is only a
          candidate; inspect its definitions before treating them as the same capability.
        </p>
        {connections.length > 0 ? (
          <div className="relationship-connection-grid">
            {connections.map((group) => (
              <ConnectionCard key={group.id} group={group} />
            ))}
          </div>
        ) : (
          <div className="relationship-empty relationship-no-connections">
            No cross-application connections match this view.
          </div>
        )}
      </section>
    </>
  );
}

function RelationshipMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="summary-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ScopeCard({ scope }: { scope: RelationshipScope }) {
  return (
    <article className="relationship-scope">
      <div className="relationship-scope-heading">
        <div className={`relationship-app-mark ${scope.application}`}>
          {scope.application === "chatgpt" ? "C" : "Cl"}
        </div>
        <div>
          <span className="relationship-app-name">{scope.applicationName}</span>
          <h3>
            {scope.scope === "global"
              ? "Global workspace"
              : (scope.projectName ?? "Project workspace")}
          </h3>
          {scope.projectRoots.length > 0 && (
            <code title={scope.projectRoots.join("\n")}>
              {scope.projectRoots.length === 1
                ? scope.projectRoots[0]
                : `${scope.projectRoots.length} linked folders · ${scope.projectRoots.join(" · ")}`}
            </code>
          )}
        </div>
        <span className="relationship-scope-count">
          {scope.plugins.length} plugins ·{" "}
          {scope.otherSkills.length +
            scope.plugins.reduce((total, plugin) => total + plugin.skills.length, 0)}{" "}
          skills ·{" "}
          {scope.otherMcpServers.length +
            scope.plugins.reduce(
              (total, plugin) => total + plugin.configuredMcpServers.length,
              0,
            )}{" "}
          MCP
        </span>
      </div>
      <div className="relationship-branches">
        {scope.plugins.length > 0 && (
          <div className="relationship-branch">
            <h4>Plugin bundles</h4>
            <div className="relationship-plugin-grid">
              {scope.plugins.map((plugin) => (
                <PluginBranch key={plugin.id} value={plugin} />
              ))}
            </div>
          </div>
        )}
        {(scope.otherSkills.length > 0 || scope.otherMcpServers.length > 0) && (
          <div className="relationship-branch">
            <h4>Outside plugin bundles</h4>
            <div className="relationship-items">
              {scope.otherSkills.map((skill) => (
                <div
                  className="relationship-item"
                  key={`${skill.application}:${skill.instructionFile}`}
                >
                  <i className="relationship-dot skill-dot" />
                  <span>
                    <strong>{skill.name}</strong>
                    <small>Skill · {skill.sourceName}</small>
                  </span>
                  <code title={skill.instructionFile}>{skill.instructionFile}</code>
                </div>
              ))}
              {scope.otherMcpServers.map((server) => (
                <div
                  className="relationship-item"
                  key={`${server.application}:${server.configurationFile}:${server.name}`}
                >
                  <i className="relationship-dot mcp-dot" />
                  <span>
                    <strong>{server.name}</strong>
                    <small>Configured MCP · {server.transport}</small>
                  </span>
                  <code title={server.configurationFile}>{server.configurationFile}</code>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

function PluginBranch({ value }: { value: RelationshipPlugin }) {
  const { plugin, skills, configuredMcpServers, packagedMcpServers } = value;
  return (
    <details className="relationship-plugin">
      <summary>
        <i className="relationship-dot plugin-dot" />
        <span>
          <strong>{plugin.displayName}</strong>
          <small>
            {plugin.installationStatus} · {plugin.originName}
          </small>
        </span>
        <span className="relationship-plugin-count">
          {skills.length} skills · {packagedMcpServers.length} packaged MCP
        </span>
      </summary>
      <div className="relationship-plugin-content">
        <code title={plugin.manifestFile}>{plugin.manifestFile}</code>
        {skills.map((skill) => (
          <div className="relationship-item" key={skill.instructionFile}>
            <i className="relationship-dot skill-dot" />
            <span>
              <strong>{skill.name}</strong>
              <small>Discovered skill</small>
            </span>
            <code title={skill.instructionFile}>{skill.instructionFile}</code>
          </div>
        ))}
        {packagedMcpServers.map((reference) => {
          const configured = configuredMcpServers.some(
            (server) =>
              server.name === reference.name &&
              server.configurationFile === reference.configurationFile,
          );
          return (
            <div
              className="relationship-item"
              key={`${reference.name}:${reference.configurationFile}`}
            >
              <i className={`relationship-dot ${configured ? "mcp-dot" : "packaged-dot"}`} />
              <span>
                <strong>{reference.name}</strong>
                <small>
                  {configured ? "Configured MCP" : "Packaged MCP · not confirmed configured"}
                </small>
              </span>
              <code title={reference.configurationFile}>{reference.configurationFile}</code>
            </div>
          );
        })}
        {skills.length === 0 && packagedMcpServers.length === 0 && (
          <p>No skill or MCP components were discovered in this bundle.</p>
        )}
      </div>
    </details>
  );
}

function ConnectionCard({ group }: { group: SkillCapabilityGroup | McpCapabilityGroup }) {
  const strong = group.matchBasis === "shared-location" || group.matchBasis === "shared-endpoint";
  return (
    <details className="relationship-connection">
      <summary>
        <i className={`relationship-dot ${group.kind === "skill" ? "skill-dot" : "mcp-dot"}`} />
        <span>
          <strong>{group.name}</strong>
          <small>{group.kind === "skill" ? "Skill" : "MCP server"} · ChatGPT ↔ Claude</small>
        </span>
        <em className={strong ? "strong" : "candidate"}>
          {strong ? "Strong evidence" : "Name-only candidate"}
        </em>
      </summary>
      <div className="relationship-connection-content">
        <p>
          {group.matchBasis === "shared-location"
            ? "At least two app records use the same skill file."
            : group.matchBasis === "shared-endpoint"
              ? "The configured endpoints match exactly in this scan; private values remain hidden."
              : "Names match, but this scan cannot establish that these are the same item."}
        </p>
        {group.definitions.map((definition) => {
          const location =
            group.kind === "skill"
              ? (definition as SkillCapabilityGroup["definitions"][number]).instructionFile
              : (definition as McpCapabilityGroup["definitions"][number]).configurationFile;
          return (
            <div
              className="relationship-connection-source"
              key={`${definition.application}:${location}`}
            >
              <span>{definition.applicationName}</span>
              <code title={location}>{location}</code>
            </div>
          );
        })}
      </div>
    </details>
  );
}

function filterScope(scope: RelationshipScope, search: string): RelationshipScope | null {
  if (
    search === "" ||
    scope.applicationName.toLocaleLowerCase().includes(search) ||
    (scope.projectName ?? "").toLocaleLowerCase().includes(search)
  ) {
    return scope;
  }

  const plugins = scope.plugins.flatMap((value) => {
    if (
      [value.plugin.name, value.plugin.displayName, value.plugin.originName].some((name) =>
        name.toLocaleLowerCase().includes(search),
      )
    ) {
      return [value];
    }
    const skills = value.skills.filter((skill) => skill.name.toLocaleLowerCase().includes(search));
    const packagedMcpServers = value.packagedMcpServers.filter((server) =>
      server.name.toLocaleLowerCase().includes(search),
    );
    if (skills.length === 0 && packagedMcpServers.length === 0) return [];
    return [
      {
        ...value,
        skills,
        packagedMcpServers,
        configuredMcpServers: value.configuredMcpServers.filter((server) =>
          server.name.toLocaleLowerCase().includes(search),
        ),
      },
    ];
  });
  const otherSkills = scope.otherSkills.filter((skill) =>
    skill.name.toLocaleLowerCase().includes(search),
  );
  const otherMcpServers = scope.otherMcpServers.filter((server) =>
    server.name.toLocaleLowerCase().includes(search),
  );

  return plugins.length || otherSkills.length || otherMcpServers.length
    ? { ...scope, plugins, otherSkills, otherMcpServers }
    : null;
}

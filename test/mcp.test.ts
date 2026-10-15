import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  discoverMcpServers,
  scanMcpConfiguration,
  type McpConfigurationLocation,
} from "../src/mcp.js";

async function temporaryDirectory(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "skillmanager-mcp-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("discovers JSON stdio servers while redacting secrets", async (t) => {
  const directory = await temporaryDirectory(t);
  const configurationFile = path.join(directory, ".mcp.json");
  await fs.writeFile(
    configurationFile,
    JSON.stringify({
      mcpServers: {
        github: {
          command: "API_TOKEN=command-secret node",
          args: ["server.js", "--api-key", "argument-secret", "sk-secretvalue"],
          env: { GITHUB_TOKEN: "environment-secret" },
        },
      },
    }),
  );

  const result = await scanMcpConfiguration({
    application: "claude",
    path: configurationFile,
    format: "json",
    scope: "project",
    projectId: "claude:test",
    projectName: "Test",
    projectRoot: directory,
  });

  assert.equal(result.mcpServers.length, 1);
  const server = result.mcpServers[0];
  assert.equal(server.transport, "stdio");
  assert.equal(server.scope, "project");
  assert.deepEqual(server.environmentVariables, ["GITHUB_TOKEN"]);
  assert.deepEqual(server.arguments, ["server.js", "--api-key", "[REDACTED]", "[REDACTED]"]);
  assert.match(server.command ?? "", /REDACTED/);
  for (const secret of ["command-secret", "argument-secret", "environment-secret", "secretvalue"]) {
    assert.doesNotMatch(server.safeConfiguration, new RegExp(secret));
  }
});

test("discovers TOML HTTP servers and keeps only credential names", async (t) => {
  const directory = await temporaryDirectory(t);
  const configurationFile = path.join(directory, "config.toml");
  await fs.writeFile(
    configurationFile,
    `[mcp_servers.docs]\nurl = "https://user:password@example.com/mcp?tenant=private"\nbearer_token_env_var = "DOCS_TOKEN"\n\n[mcp_servers.docs.http_headers]\nX-Api-Key = "literal-secret"\n`,
  );

  const result = await scanMcpConfiguration({
    application: "chatgpt",
    path: configurationFile,
    format: "toml",
    scope: "global",
  });

  const server = result.mcpServers[0];
  assert.equal(server.transport, "http");
  assert.deepEqual(server.environmentVariables, ["DOCS_TOKEN"]);
  assert.deepEqual(server.headerNames, ["X-Api-Key"]);
  assert.doesNotMatch(server.url ?? "", /user|password|private/);
  assert.doesNotMatch(server.safeConfiguration, /literal-secret|password|private/);
  assert.match(server.safeConfiguration, /REDACTED/);
});

test("redacts URL credentials, paths, fragments, unknown fields, and unusual arguments", async (t) => {
  const directory = await temporaryDirectory(t);
  const configurationFile = path.join(directory, ".mcp.json");
  const secrets = [
    "url-user",
    "url-password",
    "path-private",
    "query-private",
    "fragment-private",
    "custom-private",
    "argument-private",
  ];
  await fs.writeFile(
    configurationFile,
    JSON.stringify({
      mcpServers: {
        private: {
          url: "https://url-user:url-password@example.com/path-private/${TOKEN}?x=query-private#fragment-private",
          args: ["server.js", "--custom=argument-private", "--header", "Bearer argument-private"],
          custom: { credentialValue: "custom-private" },
        },
      },
    }),
  );
  const result = await scanMcpConfiguration({
    application: "claude",
    path: configurationFile,
    format: "json",
    scope: "global",
  });
  const server = result.mcpServers[0];
  for (const secret of secrets) {
    assert.equal(JSON.stringify(server).includes(secret), false, secret);
  }
  assert.match(server.url ?? "", /example\.com/);
  assert.match(server.safeConfiguration, /REDACTED/);
});

test("only exact private endpoints receive the same opaque cross-app identity", async (t) => {
  const directory = await temporaryDirectory(t);
  const first = path.join(directory, "one.json");
  const second = path.join(directory, "two.json");
  const third = path.join(directory, "three.json");
  const definition = (tenant: string) =>
    JSON.stringify({ mcpServers: { docs: { url: `https://example.com/mcp?tenant=${tenant}` } } });
  await Promise.all([
    fs.writeFile(first, definition("first")),
    fs.writeFile(second, definition("second")),
    fs.writeFile(third, definition("first")),
  ]);
  const result = await discoverMcpServers({
    locations: [
      { application: "chatgpt", path: first, format: "json", scope: "global" },
      { application: "claude", path: second, format: "json", scope: "global" },
      { application: "claude", path: third, format: "json", scope: "project", projectId: "three" },
    ],
  });
  const one = result.mcpServers.find((server) => server.configurationFile === first);
  const two = result.mcpServers.find((server) => server.configurationFile === second);
  const three = result.mcpServers.find((server) => server.configurationFile === third);
  assert.ok(one && two && three);
  assert.equal(one.url, two.url);
  assert.notEqual(one.endpointMatchId, two.endpointMatchId);
  assert.equal(one.endpointMatchId, three.endpointMatchId);
  assert.equal(JSON.stringify(result).includes("tenant=first"), false);
});

test("reports malformed configuration without throwing", async (t) => {
  const directory = await temporaryDirectory(t);
  const configurationFile = path.join(directory, ".mcp.json");
  await fs.writeFile(configurationFile, '{ "mcpServers": ');

  const result = await scanMcpConfiguration({
    application: "claude",
    path: configurationFile,
    format: "json",
    scope: "global",
  });

  assert.deepEqual(result.mcpServers, []);
  assert.equal(result.diagnostics[0]?.code, "MCP_CONFIG_INVALID");
});

test("isolates a deeply nested server instead of aborting the full scan", async (t) => {
  const directory = await temporaryDirectory(t);
  const configurationFile = path.join(directory, ".mcp.json");
  const nested = "[".repeat(12_000) + "0" + "]".repeat(12_000);
  await fs.writeFile(
    configurationFile,
    `{"mcpServers":{"deep":{"command":"node","custom":${nested}},"healthy":{"command":"node"}}}`,
  );
  const result = await scanMcpConfiguration({
    application: "claude",
    path: configurationFile,
    format: "json",
    scope: "global",
  });
  assert.deepEqual(
    result.mcpServers.map((server) => server.name),
    ["healthy"],
  );
  assert.equal(result.diagnostics[0]?.code, "MCP_SERVER_INVALID");
});

test("marks same-name servers in the same scope as duplicates", async (t) => {
  const directory = await temporaryDirectory(t);
  const first = path.join(directory, "one.json");
  const second = path.join(directory, "two.json");
  const contents = JSON.stringify({ mcpServers: { shared: { command: "node" } } });
  await Promise.all([fs.writeFile(first, contents), fs.writeFile(second, contents)]);

  const locations: McpConfigurationLocation[] = [first, second].map((file) => ({
    application: "claude",
    path: file,
    format: "json",
    scope: "global",
  }));
  const result = await discoverMcpServers({ locations });

  assert.deepEqual(
    result.mcpServers.map((server) => server.status),
    ["duplicate", "duplicate"],
  );
  assert.equal(
    result.diagnostics.filter((diagnostic) => diagnostic.code === "MCP_SERVER_DUPLICATE").length,
    1,
  );
});

test("keeps project and global servers with the same name as separate valid scopes", async (t) => {
  const directory = await temporaryDirectory(t);
  const globalFile = path.join(directory, "global.json");
  const projectFile = path.join(directory, "project.json");
  const contents = JSON.stringify({ mcpServers: { shared: { command: "node" } } });
  await Promise.all([fs.writeFile(globalFile, contents), fs.writeFile(projectFile, contents)]);

  const result = await discoverMcpServers({
    locations: [
      { application: "claude", path: globalFile, format: "json", scope: "global" },
      {
        application: "claude",
        path: projectFile,
        format: "json",
        scope: "project",
        projectId: "claude:project",
        projectName: "Project",
        projectRoot: directory,
      },
    ],
  });

  assert.deepEqual(
    result.mcpServers.map((server) => server.status),
    ["valid", "valid"],
  );
});

test("includes invalid server definitions with actionable issues", async (t) => {
  const directory = await temporaryDirectory(t);
  const configurationFile = path.join(directory, ".mcp.json");
  await fs.writeFile(
    configurationFile,
    JSON.stringify({ mcpServers: { broken: { type: "stdio" } } }),
  );

  const result = await scanMcpConfiguration({
    application: "claude",
    path: configurationFile,
    format: "json",
    scope: "global",
  });

  assert.equal(result.mcpServers[0]?.status, "invalid");
  assert.match(result.mcpServers[0]?.issues.join(" ") ?? "", /command/i);
  assert.equal(result.diagnostics[0]?.code, "MCP_SERVER_INVALID");
});

test("discovers Codex and Claude global and project configuration locations", async (t) => {
  const home = await temporaryDirectory(t);
  const codexProject = path.join(home, "codex-project");
  const claudeProject = path.join(home, "claude-project");
  await Promise.all([
    fs.mkdir(path.join(home, ".codex"), { recursive: true }),
    fs.mkdir(path.join(codexProject, ".codex"), { recursive: true }),
    fs.mkdir(claudeProject, { recursive: true }),
  ]);
  await Promise.all([
    fs.writeFile(
      path.join(home, ".codex", "config.toml"),
      '[mcp_servers.global-codex]\ncommand = "node"\n',
    ),
    fs.writeFile(
      path.join(codexProject, ".codex", "config.toml"),
      '[mcp_servers.project-codex]\nurl = "https://example.com/mcp"\n',
    ),
    fs.writeFile(
      path.join(home, ".claude.json"),
      JSON.stringify({
        mcpServers: { "global-claude": { command: "node" } },
        projects: {
          [claudeProject]: { mcpServers: { "state-project": { command: "python" } } },
        },
      }),
    ),
    fs.writeFile(
      path.join(claudeProject, ".mcp.json"),
      JSON.stringify({
        mcpServers: { "file-project": { type: "sse", url: "https://example.com/sse" } },
      }),
    ),
  ]);

  const result = await discoverMcpServers({
    homeDirectory: home,
    projects: [
      { application: "chatgpt", id: "codex:one", name: "Codex Project", path: codexProject },
      { application: "claude", id: "claude:one", name: "Claude Project", path: claudeProject },
    ],
  });

  assert.deepEqual(
    result.mcpServers.map((server) => [server.name, server.scope]),
    [
      ["global-codex", "global"],
      ["project-codex", "project"],
      ["file-project", "project"],
      ["global-claude", "global"],
      ["state-project", "project"],
    ],
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ManagePanel } from "../src/desktop/renderer/ManagePanel.js";

test("management view explains its narrow, confirmed, recoverable import", () => {
  const html = renderToStaticMarkup(
    createElement(ManagePanel, { onChanged: async () => undefined }),
  );
  assert.match(html, /Add to ChatGPT/);
  assert.match(html, /Add to Claude/);
  assert.match(html, /never replaced/);
  assert.match(html, /even after restarting the app/);
  assert.match(html, /Import history/);
  assert.match(html, /Archives, overwrites, updates, and automatic setup/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { getRenderableMarkdown } from "../src/markdown.js";

test("removes YAML frontmatter from the rendered skill document", () => {
  const contents = "---\nname: Example\ndescription: Test\n---\n# Instructions\n\nDo the work.\n";

  assert.equal(getRenderableMarkdown(contents), "# Instructions\n\nDo the work.\n");
});

test("keeps a Markdown document that has no frontmatter", () => {
  const contents = "# Instructions\n\n- First\n- Second\n";

  assert.equal(getRenderableMarkdown(contents), contents);
});

test("does not remove an unclosed frontmatter block", () => {
  const contents = "---\nname: Example\n# Still source text\n";

  assert.equal(getRenderableMarkdown(contents), contents);
});

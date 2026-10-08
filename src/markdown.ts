/**
 * Return the document body used by the rendered preview.
 *
 * Skill metadata already appears in the Overview tab, so the YAML frontmatter
 * is omitted from the formatted view. The Source view still shows every byte.
 */
export function getRenderableMarkdown(contents: string): string {
  const normalizedContents = contents.replace(/^\uFEFF/, "");
  const frontmatter = normalizedContents.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);

  return frontmatter
    ? normalizedContents.slice(frontmatter[0].length).trimStart()
    : normalizedContents;
}

import "server-only";
import { marked } from "marked";

/**
 * Render admin-authored Markdown (content pages). Raw HTML in the source is
 * escaped so a page can't inject scripts even if an admin pastes untrusted text.
 */
export async function renderMarkdown(source: string): Promise<string> {
  const escaped = source.replace(/</g, "&lt;");
  return marked.parse(escaped, { gfm: true, breaks: false, async: true });
}

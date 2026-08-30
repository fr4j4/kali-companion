// Central markdown/HTML sanitizer (S3 hardening).
//
// All markdown → HTML rendering MUST go through here so that LLM output,
// artifacts, and file contents can never inject scripts into the UI
// (dangerouslySetInnerHTML sites call sanitizeHtml as the last step).

import DOMPurify from "dompurify";
import { marked } from "marked";

// Safe profile: keeps code blocks, tables, images; strips
// script/style/iframe/event handlers/javascript: URLs.
const PURIFY_CONFIG = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true },
  FORBID_TAGS: ["style", "iframe", "form", "input", "button"],
  ADD_ATTR: ["target", "rel"],
};

export function sanitizeHtml(raw: string): string {
  return DOMPurify.sanitize(raw, PURIFY_CONFIG);
}

/** Full markdown → sanitized HTML pipeline. Sync, memo-friendly. */
export function renderMarkdown(md: string): string {
  const parsed = marked.parse(md ?? "", { async: false }) as string;
  return sanitizeHtml(parsed);
}
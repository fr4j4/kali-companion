import AnsiToHtml from "ansi-to-html";

const converter = new AnsiToHtml({
  escapeXML: true,
  fg: "#var(--fg)",
  bg: "#var(--bg)",
});

/**
 * Convert ANSI escape codes to HTML spans for terminal output rendering.
 * HTML special characters are escaped to prevent XSS from command output.
 */
export function ansiToHtml(text: string): string {
  return converter.toHtml(text);
}
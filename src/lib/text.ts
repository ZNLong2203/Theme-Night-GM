const UUID = "[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}";
/** "(ID: `…`)" notes and bare entity UUIDs, which the model sometimes copies from tool output into prose. */
const ID_NOTE = new RegExp(`\\s*\\((?:entity\\s+)?id:?\\s*\`?${UUID}\`?\\)|\\s*\`?\\b(?:id:?\\s*)?${UUID}\\b\`?`, "gi");

/** Drop internal IDs and code ticks from text the model wrote for people. Markdown emphasis is kept for rendering. */
export function cleanModelText(text: string): string {
  return text.replace(ID_NOTE, "").replace(/`([^`]+)`/g, "$1");
}

export function escapeTerminalControls(value: string): string {
  return value
    .replace(/\r/gu, "\\r")
    .replace(/\t/gu, "\\t")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu,
      (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

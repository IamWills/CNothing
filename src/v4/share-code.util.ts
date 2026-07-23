/** Human/agent-typable share codes: u_XXXXXX (case-insensitive). */

export function normalizeShareCodeInput(raw: string): string {
  const trimmed = raw.trim().toUpperCase();
  if (trimmed.startsWith("U_")) {
    return trimmed;
  }
  // Accept bare 6-char bodies as u_XXXXXX
  if (/^[A-Z0-9]{6}$/.test(trimmed)) {
    return `U_${trimmed}`;
  }
  return trimmed;
}

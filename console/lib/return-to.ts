/** Keep OAuth return navigation on this console origin. */
export function oauthReturnTo(search: string, origin: string, fallback: string): string {
  const raw = new URLSearchParams(search).get("redirect_after");
  if (raw) {
    try {
      const target = new URL(raw, origin);
      if (target.origin === origin && !target.username && !target.password) return target.href;
    } catch { /* Use the local fallback for malformed URLs. */ }
  }
  return new URL(fallback, origin).href;
}

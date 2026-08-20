import { ValidationError } from "../utils/errors";
import { assertSafePublicUrlWithDns } from "./url-safety.service";

/**
 * Provider metadata (OIDC discovery documents, JWKS, endpoints advertised
 * inside them) is untrusted input: it decides where CNothing will send
 * requests. Every such fetch goes through here so it gets the same SSRF
 * protection as the agent-facing proxy — public host only, https only, no
 * redirects, bounded time and size.
 */

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 512 * 1024;

export async function assertSafeMetadataUrl(rawUrl: string, label: string): Promise<URL> {
  const url = await assertSafePublicUrlWithDns(rawUrl, label);
  if (url.protocol !== "https:") {
    throw new ValidationError(`${label} must use https`, {
      error_code: "https_required",
      field: label,
    });
  }
  return url;
}

export async function fetchPublicJsonDocument<T>(
  rawUrl: string,
  options: { label: string; timeoutMs?: number; maxBytes?: number },
): Promise<T> {
  const url = await assertSafeMetadataUrl(rawUrl, options.label);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { accept: "application/json" },
      // A redirect could point at a private address that never went through
      // the checks above, so refuse to follow one.
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ValidationError(
      `Could not fetch ${options.label}: ${error instanceof Error ? error.message : String(error)}`,
      { error_code: "metadata_unreachable", field: options.label },
    );
  }

  if (!response.ok) {
    throw new ValidationError(`${options.label} returned HTTP ${response.status}`, {
      error_code: "metadata_fetch_failed",
      field: options.label,
    });
  }

  const raw = Buffer.from(await response.arrayBuffer());
  if (raw.byteLength > maxBytes) {
    throw new ValidationError(`${options.label} document is too large`, {
      error_code: "metadata_too_large",
      field: options.label,
    });
  }

  try {
    return JSON.parse(raw.toString("utf8")) as T;
  } catch {
    throw new ValidationError(`${options.label} did not return valid JSON`, {
      error_code: "metadata_invalid_json",
      field: options.label,
    });
  }
}

import { lookup } from "node:dns/promises";
import { ValidationError } from "../utils/errors";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "metadata.google.internal",
  "metadata",
]);

function isPrivateIpv4(parts: number[]): boolean {
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80")
  );
}

function parseIpv4(hostname: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) {
    return null;
  }
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => part > 255)) {
    return null;
  }
  return parts;
}

export function assertSafePublicUrl(rawUrl: string, label = "url"): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new ValidationError(`Invalid ${label}`, { error_code: "invalid_url", field: label });
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new ValidationError(`Unsupported ${label} protocol`, {
      error_code: "unsupported_url_protocol",
      field: label,
    });
  }

  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost")) {
    throw new ValidationError(`Blocked ${label} host`, {
      error_code: "ssrf_blocked",
      field: label,
    });
  }

  const ipv4 = parseIpv4(hostname);
  if (ipv4 && isPrivateIpv4(ipv4)) {
    throw new ValidationError(`Blocked private ${label} host`, {
      error_code: "ssrf_blocked",
      field: label,
    });
  }

  if (hostname.includes(":") && isPrivateIpv6(hostname)) {
    throw new ValidationError(`Blocked private ${label} host`, {
      error_code: "ssrf_blocked",
      field: label,
    });
  }

  return parsed;
}

export async function assertSafePublicUrlWithDns(rawUrl: string, label = "url"): Promise<URL> {
  const parsed = assertSafePublicUrl(rawUrl, label);
  const hostname = parsed.hostname.toLowerCase();

  if (parseIpv4(hostname) || hostname.includes(":")) {
    return parsed;
  }

  try {
    const records = await lookup(hostname, { all: true });
    for (const record of records) {
      if (record.family === 4) {
        const parts = parseIpv4(record.address);
        if (parts && isPrivateIpv4(parts)) {
          throw new ValidationError(`Blocked private ${label} host after DNS lookup`, {
            error_code: "ssrf_blocked",
            field: label,
          });
        }
      }
      if (record.family === 6 && isPrivateIpv6(record.address)) {
        throw new ValidationError(`Blocked private ${label} host after DNS lookup`, {
          error_code: "ssrf_blocked",
          field: label,
        });
      }
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError(`Unable to resolve ${label} host`, {
      error_code: "dns_resolution_failed",
      field: label,
    });
  }

  return parsed;
}

export function validatePublicMetadataUrls(input: Record<string, string | undefined>): string[] {
  const errors: string[] = [];
  for (const [field, value] of Object.entries(input)) {
    if (!value?.trim()) {
      continue;
    }
    try {
      assertSafePublicUrl(value, field);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `Invalid ${field}`);
    }
  }
  return errors;
}

export async function validatePublicMetadataUrlsWithDns(
  input: Record<string, string | undefined>,
): Promise<string[]> {
  const errors: string[] = [];
  for (const [field, value] of Object.entries(input)) {
    if (!value?.trim()) {
      continue;
    }
    try {
      await assertSafePublicUrlWithDns(value, field);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `Invalid ${field}`);
    }
  }
  return errors;
}

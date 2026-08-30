import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { CredentialStore, EnrollmentState } from "./types";

export function defaultTokenFilePath(): string {
  const explicit = process.env.CNOTHING_AGENT_TOKEN_FILE?.trim();
  if (explicit) return explicit;
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  const root = xdg ? join(xdg, "cnothing") : join(homedir(), ".config", "cnothing");
  return join(root, "agent.token");
}

export function enrollmentFilePathFor(tokenPath: string): string {
  return join(dirname(tokenPath), "enrollment.json");
}

async function ensurePrivateDir(filePath: string): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700).catch(() => undefined);
}

export class FileCredentialStore implements CredentialStore {
  constructor(private readonly tokenPath = defaultTokenFilePath()) {}

  tokenFilePath(): string {
    return this.tokenPath;
  }

  enrollmentFilePath(): string {
    return enrollmentFilePathFor(this.tokenPath);
  }

  async readToken(): Promise<string> {
    const fromEnv = process.env.CNOTHING_AGENT_TOKEN?.trim() ?? "";
    if (fromEnv) return fromEnv;
    try {
      return (await readFile(this.tokenPath, "utf8")).trim();
    } catch {
      return "";
    }
  }

  async writeToken(token: string): Promise<void> {
    await ensurePrivateDir(this.tokenPath);
    await writeFile(this.tokenPath, `${token}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(this.tokenPath, 0o600).catch(() => undefined);
    await rm(this.enrollmentFilePath(), { force: true });
  }

  async readEnrollment(): Promise<EnrollmentState | null> {
    try {
      const parsed = JSON.parse(await readFile(this.enrollmentFilePath(), "utf8")) as EnrollmentState;
      if (!parsed.enrollment_id || !parsed.enrollment_secret) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async writeEnrollment(state: EnrollmentState | null): Promise<void> {
    if (!state) {
      await rm(this.enrollmentFilePath(), { force: true });
      return;
    }
    const filePath = this.enrollmentFilePath();
    await ensurePrivateDir(filePath);
    await writeFile(filePath, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(filePath, 0o600).catch(() => undefined);
  }
}

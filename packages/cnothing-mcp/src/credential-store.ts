import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type EnrollmentState = {
  enrollment_id: string;
  enrollment_secret: string;
  approval_url: string;
  user_code: string;
  expires_at: string;
};

export function tokenFilePath(): string {
  const explicit = process.env.CNOTHING_AGENT_TOKEN_FILE?.trim();
  if (explicit) return explicit;
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  const root = xdg ? join(xdg, "cnothing") : join(homedir(), ".config", "cnothing");
  return join(root, "agent.token");
}

export function enrollmentFilePath(): string {
  return join(dirname(tokenFilePath()), "enrollment.json");
}

async function ensurePrivateDir(filePath: string): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700).catch(() => undefined);
}

export async function readEnvOrStoredToken(): Promise<string> {
  const fromEnv = process.env.CNOTHING_AGENT_TOKEN?.trim() ?? "";
  if (fromEnv) return fromEnv;
  try {
    return (await readFile(tokenFilePath(), "utf8")).trim();
  } catch {
    return "";
  }
}

export async function writeStoredToken(token: string): Promise<void> {
  const filePath = tokenFilePath();
  await ensurePrivateDir(filePath);
  await writeFile(filePath, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(filePath, 0o600).catch(() => undefined);
  await rm(enrollmentFilePath(), { force: true });
}

export async function readEnrollmentState(): Promise<EnrollmentState | null> {
  try {
    const parsed = JSON.parse(await readFile(enrollmentFilePath(), "utf8")) as EnrollmentState;
    if (!parsed.enrollment_id || !parsed.enrollment_secret) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeEnrollmentState(state: EnrollmentState): Promise<void> {
  const filePath = enrollmentFilePath();
  await ensurePrivateDir(filePath);
  await writeFile(filePath, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(filePath, 0o600).catch(() => undefined);
}

export function userVisibleEnrollment(state: Pick<EnrollmentState, "approval_url" | "user_code" | "expires_at">) {
  return {
    ok: false as const,
    status: "enrollment_required" as const,
    next_action: "wait_for_user" as const,
    retry_after_seconds: 5,
    user_action: {
      message:
        "Open this CNothing URL and confirm the pairing code matches. Do not paste any token into chat.",
      approval_url: state.approval_url,
      user_code: state.user_code,
    },
    expires_at: state.expires_at,
  };
}

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

const outputDir = path.join(process.cwd(), ".local-keys");
if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

const masterKey = randomBytes(32).toString("base64url");
const operatorToken = `admin_${randomBytes(32).toString("base64url")}`;
const envPath = path.join(outputDir, "generated.env");
writeFileSync(
  envPath,
  `KEYSERVICE_MASTER_KEY=${masterKey}\nKEYSERVICE_BEARER_TOKEN=${operatorToken}\n`,
  { encoding: "utf8", mode: 0o600 },
);

console.log(`Generated CNothing v4 master key and service credential in ${envPath}. KEYSERVICE_BEARER_TOKEN is a bootstrap/automation secret, not a human Console login. Keep it secret and back it up securely.`);

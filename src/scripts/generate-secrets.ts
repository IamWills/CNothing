import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { generateKeyPairSync, randomBytes } from "node:crypto";

function base64Url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

const cwd = process.cwd();
const outputDir = path.join(cwd, ".local-keys");

if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}

const masterKey = base64Url(randomBytes(32));

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 4096,
  publicKeyEncoding: {
    type: "spki",
    format: "pem",
  },
  privateKeyEncoding: {
    type: "pkcs8",
    format: "pem",
  },
});

const privateKeyPath = path.join(outputDir, "authai-private-key.pem");
const publicKeyPath = path.join(outputDir, "authai-public-key.pem");
const envPath = path.join(outputDir, "generated.env");

writeFileSync(privateKeyPath, privateKey, { encoding: "utf8", mode: 0o600 });
writeFileSync(publicKeyPath, publicKey, { encoding: "utf8", mode: 0o644 });

const envContent = [
  `KEYSERVICE_MASTER_KEY=${masterKey}`,
  "KEYSERVICE_AUTHAI_PRIVATE_KEY_PATH=.local-keys/authai-private-key.pem",
  "KEYSERVICE_AUTHAI_PUBLIC_KEY_PATH=.local-keys/authai-public-key.pem",
  "",
].join("\n");

writeFileSync(envPath, envContent, { encoding: "utf8", mode: 0o600 });

// eslint-disable-next-line no-console
console.log("Generated keyservice secrets:");
// eslint-disable-next-line no-console
console.log(`- master key written to: ${envPath}`);
// eslint-disable-next-line no-console
console.log(`- authai private key: ${privateKeyPath}`);
// eslint-disable-next-line no-console
console.log(`- authai public key: ${publicKeyPath}`);
// eslint-disable-next-line no-console
console.log("");
// eslint-disable-next-line no-console
console.log("Suggested next steps:");
// eslint-disable-next-line no-console
console.log(`1. Copy values from ${envPath} into ${path.join(cwd, ".env")}`);
// eslint-disable-next-line no-console
console.log("2. Set DATABASE_URL in .env");
// eslint-disable-next-line no-console
console.log("3. Run: bun run migrate");

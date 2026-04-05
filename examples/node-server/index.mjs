import { CNothingClient, generateClientKeyPair } from "cnothing";

const generated = generateClientKeyPair();
const privateKeyPem =
  process.env.CNOTHING_CLIENT_PRIVATE_KEY_PEM ?? generated.privateKeyPem;
const publicKeyPem =
  process.env.CNOTHING_CLIENT_PUBLIC_KEY_PEM ?? generated.publicKeyPem;
const privacyKey = process.env.CNOTHING_PRIVACY_KEY ?? "replace-me-in-production";

const client = new CNothingClient({
  baseUrl: process.env.CNOTHING_BASE_URL ?? "https://cnothing.com",
  clientPrivateKeyPem: privateKeyPem,
  clientPublicKeyPem: publicKeyPem,
  clientLabel: process.env.CNOTHING_CLIENT_LABEL ?? "node-example",
  privacyKey,
});

const session = await client.register();
console.log("Registered client:", session.clientUuid);

const namespace = process.env.CNOTHING_NAMESPACE ?? "examples.node.production";
const key = process.env.CNOTHING_KEY ?? "demo/secret";

await client.saveBlindJson({
  namespace,
  items: [
    {
      key,
      value: {
        token: process.env.CNOTHING_SECRET_VALUE ?? "secret-value",
      },
      metadata: {
        source: "node-example",
      },
    },
  ],
});

const readResult = await client.readBlindJson({
  namespace,
  keys: [key],
});

console.log("Decrypted value:", readResult.items[key]);

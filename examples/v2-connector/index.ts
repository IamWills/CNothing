import { createConnectorHandler } from "../../src/connector-sdk/index";

const connectorId = process.env.DEMO_CONNECTOR_ID ?? "demo-connector";
const cnothingPublicKeyPem = process.env.CNOTHING_PUBLIC_KEY_PEM ?? "";
const port = Number(process.env.PORT ?? "3030");

const handler = createConnectorHandler({
  connectorId,
  cnothingPublicKeyPem,
  executeCapability: async (input) => {
    switch (input.capability) {
      case "demo.echo":
        return { echoed: input.input, user_id: input.user_id, agent_id: input.agent_id };
      case "github.create_issue":
        return {
          issue_number: 42,
          url: `https://github.com/${String(input.input.repo ?? "org/repo")}/issues/42`,
          title: input.input.title ?? "Untitled",
        };
      default:
        throw new Error(`Unsupported capability: ${input.capability}`);
    }
  },
});

Bun.serve({ port, fetch: handler });

console.log(`Demo connector listening on http://localhost:${port}`);

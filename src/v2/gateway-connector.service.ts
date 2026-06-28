import config from "../config";
import { createConnector, findConnectorByProvider, updateConnectorCallbackUrl } from "./v2.repository";
import { PLATFORM_CONNECTOR_PROVIDER } from "./platform-connector.executor";

export async function ensureGatewayConnector() {
  const callbackUrl = `${config.publicBaseUrl.replace(/\/+$/, "")}/v2/internal/connectors/platform`;
  let connector = await findConnectorByProvider(PLATFORM_CONNECTOR_PROVIDER);
  if (!connector) {
    connector = await createConnector({
      provider: PLATFORM_CONNECTOR_PROVIDER,
      display_name: "CNothing Capability Gateway",
      callback_url: callbackUrl,
      metadata: { built_in: true, role: "gateway", version: "2.5" },
    });
  } else if (connector.callback_url !== callbackUrl) {
    connector = (await updateConnectorCallbackUrl(connector.id, callbackUrl)) ?? connector;
  }
  return connector;
}

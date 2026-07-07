import { randomUUID } from "node:crypto";
import { ConflictError, NotFoundError, ValidationError } from "../utils/errors";
import { discoverOAuthProvider } from "../v2/oidc-provider-discovery.service";
import { findOAuthProviderBySlug } from "../v2/oauth.repository";
import { oauthProviderService } from "../v2/oauth-connection.service";
import type { AgentRecord } from "../v2/v2.entity";
import type { ProviderProposalInput, ProviderProposalPublicView } from "./v3.entity";
import {
  findProviderProposalForAgent,
  insertProviderProposal,
  updateProviderProposal,
  writeTrustAudit,
} from "./v3.repository";
import { buildOAuthCallbackUri, registerOAuthClient } from "./dcr.service";
import { assertSafePublicUrlWithDns } from "./url-safety.service";

function slugifyProviderName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || `provider-${randomUUID().slice(0, 8)}`;
}

function assessProviderRisk(input: {
  issuer_url?: string | null;
  authorization_url?: string | null;
  token_url?: string | null;
  scopes?: string[];
  risk_suggestion?: string;
}): Record<string, unknown> {
  const flags: string[] = [];
  const urls = [input.issuer_url, input.authorization_url, input.token_url].filter(Boolean);

  for (const url of urls) {
    if (url && !url.startsWith("https://")) {
      flags.push("non_https_endpoint");
    }
  }

  const privilegedScopes = (input.scopes ?? []).filter((scope) =>
    /admin|delete|write|manage|full|secret/i.test(scope),
  );
  if (privilegedScopes.length > 0) {
    flags.push("privileged_scopes");
  }

  let level: "LOW" | "MEDIUM" | "HIGH" = "LOW";
  if (flags.includes("non_https_endpoint")) {
    level = "HIGH";
  } else if (flags.includes("privileged_scopes")) {
    level = "MEDIUM";
  }

  if (input.risk_suggestion === "HIGH" || input.risk_suggestion === "CONFIDENTIAL") {
    level = input.risk_suggestion === "CONFIDENTIAL" ? "HIGH" : "HIGH";
  }

  return {
    level,
    flags,
    privileged_scopes: privilegedScopes,
    auto_assessed: true,
  };
}

async function tryDynamicClientRegistration(input: {
  registration_endpoint: string;
  redirect_uri: string;
  provider_name: string;
  scopes: string[];
}) {
  return registerOAuthClient({
    registration_endpoint: input.registration_endpoint,
    redirect_uri: input.redirect_uri,
    provider_name: input.provider_name,
    scopes: input.scopes,
  });
}

function toPublicView(input: {
  proposal: Awaited<ReturnType<typeof insertProviderProposal>>;
  connectable: boolean;
  credential_setup_required: boolean;
}): ProviderProposalPublicView {
  return {
    id: input.proposal.id,
    status: input.proposal.status,
    provider_name: input.proposal.provider_name,
    proposed_slug: input.proposal.proposed_slug,
    provider_id: input.proposal.provider_id,
    connectable: input.connectable,
    credential_setup_required: input.credential_setup_required,
    risk_assessment: input.proposal.risk_assessment,
    validation_errors: input.proposal.validation_errors,
    scopes: input.proposal.scopes,
    created_at: input.proposal.created_at,
    updated_at: input.proposal.updated_at,
  };
}

export class ProviderProposalService {
  async submitProposal(input: {
    agent: AgentRecord;
    body: ProviderProposalInput;
    apiBaseUrl: string;
  }): Promise<ProviderProposalPublicView> {
    const providerName = input.body.provider_name?.trim();
    if (!providerName) {
      throw new ValidationError("provider_name is required");
    }

    const proposedSlug = slugifyProviderName(input.body.slug?.trim() || providerName);
    const existingProvider = await findOAuthProviderBySlug(proposedSlug);
    if (existingProvider) {
      throw new ConflictError("Provider already exists", {
        error_code: "provider_exists",
        provider_id: existingProvider.id,
        slug: proposedSlug,
      });
    }

    const urlFields: Record<string, string | undefined> = {
      issuer_url: input.body.issuer_url,
      discovery_url: input.body.discovery_url,
      authorization_url: input.body.authorization_url,
      token_url: input.body.token_url,
      jwks_url: input.body.jwks_url,
      userinfo_url: input.body.userinfo_url,
      registration_endpoint: input.body.registration_endpoint,
      openapi_url: input.body.openapi_url,
      mcp_url: input.body.mcp_url,
      logo_url: input.body.logo_url,
      api_base_url: input.body.api_base_url,
    };

    const validationErrors: string[] = [];
    for (const [field, value] of Object.entries(urlFields)) {
      if (!value?.trim()) {
        continue;
      }
      try {
        await assertSafePublicUrlWithDns(value, field);
      } catch (error) {
        validationErrors.push(error instanceof Error ? error.message : `Invalid ${field}`);
      }
    }

    let issuerUrl = input.body.issuer_url?.trim() || null;
    let discoveryUrl = input.body.discovery_url?.trim() || null;
    let authorizationUrl = input.body.authorization_url?.trim() || null;
    let tokenUrl = input.body.token_url?.trim() || null;
    let userinfoUrl = input.body.userinfo_url?.trim() || null;
    let jwksUrl = input.body.jwks_url?.trim() || null;
    let registrationEndpoint = input.body.registration_endpoint?.trim() || null;
    let deviceAuthorizationEndpoint: string | null = null;
    let scopes = input.body.scopes ?? [];

    if ((discoveryUrl || issuerUrl) && validationErrors.length === 0) {
      try {
        const discovered = await discoverOAuthProvider({
          discovery_url: discoveryUrl ?? undefined,
          issuer: issuerUrl ?? undefined,
        });
        issuerUrl = discovered.issuer;
        authorizationUrl = authorizationUrl ?? discovered.authorization_url;
        tokenUrl = tokenUrl ?? discovered.token_url;
        userinfoUrl = userinfoUrl ?? discovered.userinfo_url ?? null;
        jwksUrl = jwksUrl ?? discovered.jwks_url ?? null;
        registrationEndpoint =
          registrationEndpoint ?? discovered.registration_endpoint ?? null;
        deviceAuthorizationEndpoint = discovered.device_authorization_endpoint ?? null;
        if (scopes.length === 0 && discovered.scopes_supported.length > 0) {
          scopes = discovered.scopes_supported;
        }
        if (!discoveryUrl) {
          discoveryUrl = `${issuerUrl.replace(/\/+$/, "")}/.well-known/openid-configuration`;
        }
      } catch (error) {
        validationErrors.push(
          error instanceof Error ? error.message : "OIDC discovery failed",
        );
      }
    }

    if (!authorizationUrl || !tokenUrl) {
      validationErrors.push("authorization_url and token_url are required after discovery");
    }

    const riskAssessment = assessProviderRisk({
      issuer_url: issuerUrl,
      authorization_url: authorizationUrl,
      token_url: tokenUrl,
      scopes,
      risk_suggestion: input.body.risk_suggestion,
    });

    const proposal = await insertProviderProposal({
      agent_id: input.agent.id,
      tenant_id: input.agent.tenant_id,
      provider_name: providerName,
      proposed_slug: proposedSlug,
      issuer_url: issuerUrl,
      discovery_url: discoveryUrl,
      authorization_url: authorizationUrl,
      token_url: tokenUrl,
      jwks_url: jwksUrl,
      userinfo_url: userinfoUrl,
      registration_endpoint: registrationEndpoint,
      openapi_url: input.body.openapi_url?.trim() || null,
      mcp_url: input.body.mcp_url?.trim() || null,
      scopes,
      risk_assessment: riskAssessment,
      validation_errors: validationErrors,
      metadata: {
        description: input.body.description ?? "",
        logo_url: input.body.logo_url ?? null,
        api_base_url: input.body.api_base_url ?? null,
        submitted_by_agent: input.agent.name,
      },
      status: validationErrors.length > 0 ? "rejected" : "validated",
    });

    await writeTrustAudit({
      event_type: "provider_proposal",
      agent_id: input.agent.id,
      metadata: {
        proposal_id: proposal.id,
        proposed_slug: proposedSlug,
        status: proposal.status,
        risk_level: riskAssessment.level,
      },
    });

    if (validationErrors.length > 0) {
      return toPublicView({
        proposal,
        connectable: false,
        credential_setup_required: true,
      });
    }

    let clientId: string | undefined;
    let clientSecret: string | undefined;
    let tokenAuthMethod: "client_secret_basic" | "client_secret_post" | "none" = "none";
    let pkceRequired = true;

    if (registrationEndpoint) {
      const redirectUri = buildOAuthCallbackUri(input.apiBaseUrl, proposedSlug, "v3");
      const registered = await tryDynamicClientRegistration({
        registration_endpoint: registrationEndpoint,
        redirect_uri: redirectUri,
        provider_name: providerName,
        scopes,
      });
      if (registered) {
        clientId = registered.client_id;
        clientSecret = registered.client_secret;
        tokenAuthMethod = clientSecret ? "client_secret_basic" : "none";
      }
    }

    const provider = await oauthProviderService.createProvider({
      slug: proposedSlug,
      display_name: providerName,
      auth_type: issuerUrl ? "oidc" : "oauth2",
      issuer: issuerUrl ?? undefined,
      discovery_url: discoveryUrl ?? undefined,
      authorization_url: authorizationUrl ?? undefined,
      token_url: tokenUrl ?? undefined,
      userinfo_url: userinfoUrl ?? undefined,
      jwks_url: jwksUrl ?? undefined,
      client_id: clientId,
      client_secret: clientSecret,
      registration_endpoint: registrationEndpoint ?? undefined,
      device_authorization_endpoint: deviceAuthorizationEndpoint ?? undefined,
      default_scopes: scopes.slice(0, 5),
      supported_scopes: scopes,
      pkce_required: pkceRequired,
      token_auth_method: tokenAuthMethod,
      metadata: {
        source: "agent_proposal",
        proposal_id: proposal.id,
        openapi_url: input.body.openapi_url ?? null,
        mcp_url: input.body.mcp_url ?? null,
        api_base_url: input.body.api_base_url ?? null,
      },
    });

    const updated = await updateProviderProposal(proposal.id, {
      status: "created",
      provider_id: provider.id,
    });

    await writeTrustAudit({
      event_type: "provider_created",
      agent_id: input.agent.id,
      provider_id: provider.id,
      metadata: {
        proposal_id: proposal.id,
        slug: proposedSlug,
        connectable: Boolean(provider.client_id),
      },
    });

    const credentialSetupRequired = !provider.client_id;
    return toPublicView({
      proposal: updated ?? proposal,
      connectable: Boolean(provider.client_id) && provider.status === "active",
      credential_setup_required: credentialSetupRequired,
    });
  }

  async getProposal(input: { agent: AgentRecord; proposalId: string }): Promise<ProviderProposalPublicView> {
    const proposal = await findProviderProposalForAgent({
      id: input.proposalId,
      agent_id: input.agent.id,
    });
    if (!proposal) {
      throw new NotFoundError("Provider proposal not found");
    }

    let connectable = false;
    let credentialSetupRequired = true;
    if (proposal.provider_id) {
      const provider = await oauthProviderService.getProvider(proposal.provider_id);
      connectable = provider.connectable;
      credentialSetupRequired = !provider.connectable;
    }

    return toPublicView({ proposal, connectable, credential_setup_required: credentialSetupRequired });
  }
}

export const providerProposalService = new ProviderProposalService();

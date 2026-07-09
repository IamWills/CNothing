import type { JsonObject } from "./v2.entity";
import type { CapabilitySource, InvocationType } from "./v2.5.entity";

export type BuiltinCapabilityTemplate = {
  name: string;
  display_name: string;
  description: string;
  capability_type: "ACTION" | "QUERY" | "CONFIDENTIAL_QUERY";
  risk_level: "PUBLIC" | "LOW" | "MEDIUM" | "HIGH" | "CONFIDENTIAL";
  scopes: string[];
  input_schema: JsonObject;
  output_schema: JsonObject;
  source: CapabilitySource;
  invocation_type: InvocationType;
  invocation_config: JsonObject;
  policy_config: JsonObject;
  execution_type?: "oauth_api" | "api_key_api" | "browser" | "ssh" | "webhook" | "manual" | "hybrid";
  approval_policy?:
    | "none"
    | "once"
    | "once_per_scope"
    | "once_per_resource"
    | "every_time"
    | "time_window"
    | "amount_threshold"
    | "manual_review";
};

export const GITHUB_CAPABILITY_TEMPLATES: BuiltinCapabilityTemplate[] = [
  {
    name: "github.oauth.connect",
    display_name: "Connect GitHub OAuth",
    description: "Return a user-facing URL to connect GitHub OAuth (never returns tokens)",
    capability_type: "ACTION",
    risk_level: "LOW",
    scopes: [],
    input_schema: { type: "object", properties: {} },
    output_schema: {
      type: "object",
      properties: {
        connect_url: { type: "string" },
        provider: { type: "string" },
      },
    },
    source: "provider_template",
    invocation_type: "builtin",
    invocation_config: { handler: "github.oauth.connect" },
    policy_config: {},
    execution_type: "oauth_api",
    approval_policy: "none",
  },
  {
    name: "github.list_repositories",
    display_name: "List Repositories",
    description: "List GitHub repositories for the connected account",
    capability_type: "QUERY",
    risk_level: "LOW",
    scopes: ["repo"],
    input_schema: {
      type: "object",
      properties: { per_page: { type: "number" }, type: { type: "string" } },
    },
    output_schema: { type: "object" },
    source: "provider_template",
    invocation_type: "builtin",
    invocation_config: { handler: "github.list_repositories" },
    policy_config: {},
    execution_type: "oauth_api",
    approval_policy: "none",
  },
  {
    name: "github.list_repos",
    display_name: "List Repos",
    description: "Alias of github.list_repositories",
    capability_type: "QUERY",
    risk_level: "LOW",
    scopes: ["repo"],
    input_schema: {
      type: "object",
      properties: { per_page: { type: "number" }, type: { type: "string" } },
    },
    output_schema: { type: "object" },
    source: "provider_template",
    invocation_type: "builtin",
    invocation_config: { handler: "github.list_repos" },
    policy_config: {},
    execution_type: "oauth_api",
    approval_policy: "none",
  },
  {
    name: "github.get_user",
    display_name: "Get User",
    description: "Get GitHub user profile for the connected account",
    capability_type: "QUERY",
    risk_level: "LOW",
    scopes: ["read:user"],
    input_schema: { type: "object", properties: {} },
    output_schema: { type: "object" },
    source: "provider_template",
    invocation_type: "builtin",
    invocation_config: { handler: "github.get_user" },
    policy_config: {},
    execution_type: "oauth_api",
    approval_policy: "none",
  },
  {
    name: "github.create_repo",
    display_name: "Create Repository",
    description: "Create a GitHub repository (requires approval once per repo name)",
    capability_type: "ACTION",
    risk_level: "MEDIUM",
    scopes: ["repo"],
    input_schema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        private: { type: "boolean" },
        org: { type: "string", description: "Optional org; creates under user if omitted" },
        auto_init: { type: "boolean" },
      },
    },
    output_schema: { type: "object" },
    source: "provider_template",
    invocation_type: "builtin",
    invocation_config: { handler: "github.create_repo" },
    policy_config: {},
    execution_type: "oauth_api",
    approval_policy: "once_per_resource",
  },
  {
    name: "github.create_issue",
    display_name: "Create Issue",
    description: "Create a GitHub issue in a repository",
    capability_type: "ACTION",
    risk_level: "MEDIUM",
    scopes: ["repo"],
    input_schema: {
      type: "object",
      required: ["owner", "repo", "title"],
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
      },
    },
    output_schema: { type: "object" },
    source: "provider_template",
    invocation_type: "builtin",
    invocation_config: { handler: "github.create_issue" },
    policy_config: {},
    execution_type: "oauth_api",
    approval_policy: "once_per_resource",
  },
  {
    name: "github.delete_repo",
    display_name: "Delete Repository",
    description: "Delete a GitHub repository (high risk, denied by default policy)",
    capability_type: "ACTION",
    risk_level: "HIGH",
    scopes: ["delete_repo"],
    input_schema: {
      type: "object",
      required: ["owner", "repo"],
      properties: { owner: { type: "string" }, repo: { type: "string" } },
    },
    output_schema: { type: "object" },
    source: "provider_template",
    invocation_type: "builtin",
    invocation_config: { handler: "github.delete_repo" },
    policy_config: { require_user_confirmation: true },
    execution_type: "oauth_api",
    approval_policy: "every_time",
  },
];

export const GOOGLE_CAPABILITY_TEMPLATES: BuiltinCapabilityTemplate[] = [
  {
    name: "google.userinfo",
    display_name: "User Info",
    description: "Get Google user profile",
    capability_type: "QUERY",
    risk_level: "LOW",
    scopes: ["openid", "email", "profile"],
    input_schema: { type: "object", properties: {} },
    output_schema: { type: "object" },
    source: "provider_template",
    invocation_type: "builtin",
    invocation_config: { handler: "google.userinfo" },
    policy_config: {},
  },
  {
    name: "gmail.send_email",
    display_name: "Send Email",
    description: "Send an email via Gmail",
    capability_type: "ACTION",
    risk_level: "MEDIUM",
    scopes: ["https://www.googleapis.com/auth/gmail.send"],
    input_schema: {
      type: "object",
      required: ["to", "subject", "body"],
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
      },
    },
    output_schema: { type: "object" },
    source: "provider_template",
    invocation_type: "builtin",
    invocation_config: { handler: "gmail.send_email" },
    policy_config: {},
  },
  {
    name: "gmail.list_messages_metadata",
    display_name: "List Messages (Metadata)",
    description: "List Gmail message metadata without body content",
    capability_type: "QUERY",
    risk_level: "MEDIUM",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    input_schema: {
      type: "object",
      properties: { max_results: { type: "number" }, query: { type: "string" } },
    },
    output_schema: { type: "object" },
    source: "provider_template",
    invocation_type: "builtin",
    invocation_config: { handler: "gmail.list_messages_metadata", metadata_only: true },
    policy_config: { metadata_only: true },
  },
  {
    name: "gmail.read_message",
    display_name: "Read Message",
    description: "Read full Gmail message content (confidential)",
    capability_type: "CONFIDENTIAL_QUERY",
    risk_level: "CONFIDENTIAL",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    input_schema: {
      type: "object",
      required: ["message_id"],
      properties: { message_id: { type: "string" } },
    },
    output_schema: { type: "object" },
    source: "provider_template",
    invocation_type: "builtin",
    invocation_config: { handler: "gmail.read_message" },
    policy_config: { require_user_confirmation: true },
  },
];

export const SLACK_CAPABILITY_TEMPLATES: BuiltinCapabilityTemplate[] = [
  {
    name: "slack.list_channels",
    display_name: "List Channels",
    description: "List Slack channels",
    capability_type: "QUERY",
    risk_level: "LOW",
    scopes: ["channels:read"],
    input_schema: { type: "object", properties: {} },
    output_schema: { type: "object" },
    source: "provider_template",
    invocation_type: "builtin",
    invocation_config: { handler: "slack.list_channels" },
    policy_config: {},
  },
  {
    name: "slack.post_message",
    display_name: "Post Message",
    description: "Post a message to a Slack channel",
    capability_type: "ACTION",
    risk_level: "MEDIUM",
    scopes: ["chat:write"],
    input_schema: {
      type: "object",
      required: ["channel", "text"],
      properties: { channel: { type: "string" }, text: { type: "string" } },
    },
    output_schema: { type: "object" },
    source: "provider_template",
    invocation_type: "builtin",
    invocation_config: { handler: "slack.post_message" },
    policy_config: {},
  },
];

export const MICROSOFT_CAPABILITY_TEMPLATES: BuiltinCapabilityTemplate[] = [
  {
    name: "microsoft.userinfo",
    display_name: "User Info",
    description: "Get Microsoft user profile via Graph API",
    capability_type: "QUERY",
    risk_level: "LOW",
    scopes: ["User.Read"],
    input_schema: { type: "object", properties: {} },
    output_schema: { type: "object" },
    source: "provider_template",
    invocation_type: "builtin",
    invocation_config: { handler: "microsoft.userinfo" },
    policy_config: {},
  },
  {
    name: "outlook.send_mail",
    display_name: "Send Mail",
    description: "Send an email via Microsoft Outlook",
    capability_type: "ACTION",
    risk_level: "MEDIUM",
    scopes: ["Mail.Send"],
    input_schema: {
      type: "object",
      required: ["to", "subject", "body"],
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
      },
    },
    output_schema: { type: "object" },
    source: "provider_template",
    invocation_type: "builtin",
    invocation_config: { handler: "outlook.send_mail" },
    policy_config: {},
  },
];

export const NOTION_CAPABILITY_TEMPLATES: BuiltinCapabilityTemplate[] = [
  {
    name: "notion.search",
    display_name: "Search",
    description: "Search Notion workspace",
    capability_type: "QUERY",
    risk_level: "LOW",
    scopes: [],
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
    },
    output_schema: { type: "object" },
    source: "provider_template",
    invocation_type: "builtin",
    invocation_config: { handler: "notion.search" },
    policy_config: {},
  },
  {
    name: "notion.create_page",
    display_name: "Create Page",
    description: "Create a Notion page",
    capability_type: "ACTION",
    risk_level: "MEDIUM",
    scopes: [],
    input_schema: {
      type: "object",
      required: ["parent_id", "title"],
      properties: {
        parent_id: { type: "string" },
        title: { type: "string" },
        content: { type: "string" },
      },
    },
    output_schema: { type: "object" },
    source: "provider_template",
    invocation_type: "builtin",
    invocation_config: { handler: "notion.create_page" },
    policy_config: {},
  },
];

export const BUILTIN_PROVIDER_TEMPLATES: Record<string, BuiltinCapabilityTemplate[]> = {
  github: GITHUB_CAPABILITY_TEMPLATES,
  google: GOOGLE_CAPABILITY_TEMPLATES,
  microsoft: MICROSOFT_CAPABILITY_TEMPLATES,
  slack: SLACK_CAPABILITY_TEMPLATES,
  notion: NOTION_CAPABILITY_TEMPLATES,
};

export const ENV_CLIENT_ID_KEYS: Record<string, string> = {
  github: "KEYSERVICE_GITHUB_OAUTH_CLIENT_ID",
  google: "KEYSERVICE_GOOGLE_OAUTH_CLIENT_ID",
  microsoft: "KEYSERVICE_MICROSOFT_OAUTH_CLIENT_ID",
  slack: "KEYSERVICE_SLACK_OAUTH_CLIENT_ID",
  notion: "KEYSERVICE_NOTION_OAUTH_CLIENT_ID",
};

export const ENV_CLIENT_SECRET_KEYS: Record<string, string> = {
  github: "KEYSERVICE_GITHUB_OAUTH_CLIENT_SECRET",
  google: "KEYSERVICE_GOOGLE_OAUTH_CLIENT_SECRET",
  microsoft: "KEYSERVICE_MICROSOFT_OAUTH_CLIENT_SECRET",
  slack: "KEYSERVICE_SLACK_OAUTH_CLIENT_SECRET",
  notion: "KEYSERVICE_NOTION_OAUTH_CLIENT_SECRET",
};

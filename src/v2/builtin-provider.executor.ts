import type { JsonObject } from "./v2.entity";

function requireAccessToken(accessToken: string | undefined, provider: string): string {
  if (!accessToken?.trim()) {
    throw new Error(
      `${provider} OAuth connection required. Connect at /connect and approve a grant with a connection.`,
    );
  }
  return accessToken;
}

async function googleApiRequest(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<unknown> {
  const url = path.startsWith("http") ? path : `https://www.googleapis.com${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error?: { message?: string } }).error?.message ?? "Google API error")
        : `Google API returned ${response.status}`;
    throw new Error(message);
  }
  return data;
}

function buildRawEmail(input: { to: string; subject: string; body: string }): string {
  const lines = [
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    input.body,
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

async function slackApiRequest(
  method: string,
  accessToken: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = (await response.json()) as { ok?: boolean; error?: string };
  if (!response.ok || !data.ok) {
    throw new Error(data.error ?? `Slack API returned ${response.status}`);
  }
  return data;
}

export async function executeGoogleCapability(input: {
  capability: string;
  payload: JsonObject;
  accessToken?: string;
}): Promise<unknown> {
  const token = requireAccessToken(input.accessToken, "Google");

  switch (input.capability) {
    case "google.userinfo": {
      const data = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!data.ok) {
        throw new Error(`Google userinfo returned ${data.status}`);
      }
      return { user: await data.json() };
    }

    case "gmail.send_email": {
      const to = String(input.payload.to ?? "");
      const subject = String(input.payload.subject ?? "");
      const body = String(input.payload.body ?? "");
      if (!to.trim() || !subject.trim()) {
        throw new Error("input.to and input.subject are required");
      }
      const raw = buildRawEmail({ to, subject, body });
      const result = await googleApiRequest("/gmail/v1/users/me/messages/send", token, {
        method: "POST",
        body: JSON.stringify({ raw }),
      });
      return { message: result };
    }

    case "gmail.list_messages_metadata": {
      const maxResults = Number(input.payload.max_results ?? 10);
      const query = typeof input.payload.query === "string" ? input.payload.query : undefined;
      const params = new URLSearchParams({
        maxResults: String(Math.min(Math.max(maxResults, 1), 50)),
      });
      if (query?.trim()) {
        params.set("q", query.trim());
      }
      const list = (await googleApiRequest(
        `/gmail/v1/users/me/messages?${params.toString()}`,
        token,
      )) as { messages?: Array<{ id: string; threadId?: string }> };

      const messages = list.messages ?? [];
      const metadata = [];
      for (const item of messages.slice(0, maxResults)) {
        const detail = (await googleApiRequest(
          `/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
          token,
        )) as {
          id?: string;
          threadId?: string;
          snippet?: string;
          labelIds?: string[];
          payload?: { headers?: Array<{ name?: string; value?: string }> };
        };
        metadata.push({
          id: detail.id,
          thread_id: detail.threadId,
          snippet: detail.snippet,
          label_ids: detail.labelIds,
          headers: detail.payload?.headers ?? [],
        });
      }
      return { count: metadata.length, messages: metadata };
    }

    case "gmail.read_message": {
      const messageId = String(input.payload.message_id ?? "");
      if (!messageId.trim()) {
        throw new Error("input.message_id is required");
      }
      const message = await googleApiRequest(
        `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`,
        token,
      );
      return { message };
    }

    default:
      throw new Error(`Unsupported Google capability: ${input.capability}`);
  }
}

export async function executeSlackCapability(input: {
  capability: string;
  payload: JsonObject;
  accessToken?: string;
}): Promise<unknown> {
  const token = requireAccessToken(input.accessToken, "Slack");

  switch (input.capability) {
    case "slack.list_channels": {
      const result = (await slackApiRequest("conversations.list", token, {
        types: "public_channel,private_channel",
        exclude_archived: true,
        limit: Number(input.payload.limit ?? 100),
      })) as { channels?: unknown[] };
      return {
        channels: (result.channels ?? []).map((channel) => {
          const item = channel as Record<string, unknown>;
          return {
            id: item.id,
            name: item.name,
            is_private: item.is_private,
            is_archived: item.is_archived,
            num_members: item.num_members,
          };
        }),
      };
    }

    case "slack.post_message": {
      const channel = String(input.payload.channel ?? "");
      const text = String(input.payload.text ?? "");
      if (!channel.trim() || !text.trim()) {
        throw new Error("input.channel and input.text are required");
      }
      const result = await slackApiRequest("chat.postMessage", token, {
        channel,
        text,
        thread_ts: typeof input.payload.thread_ts === "string" ? input.payload.thread_ts : undefined,
      });
      return { result };
    }

    default:
      throw new Error(`Unsupported Slack capability: ${input.capability}`);
  }
}

export function isGoogleCapability(name: string): boolean {
  return name.startsWith("google.") || name.startsWith("gmail.");
}

export function isSlackCapability(name: string): boolean {
  return name.startsWith("slack.");
}

export function isNotionCapability(name: string): boolean {
  return name.startsWith("notion.");
}

async function notionApiRequest(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetch(`https://api.notion.com${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
      "notion-version": "2022-06-28",
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "message" in data
        ? String((data as { message?: string }).message ?? "Notion API error")
        : `Notion API returned ${response.status}`;
    throw new Error(message);
  }
  return data;
}

export async function executeNotionCapability(input: {
  capability: string;
  payload: JsonObject;
  accessToken?: string;
}): Promise<unknown> {
  const token = requireAccessToken(input.accessToken, "Notion");

  switch (input.capability) {
    case "notion.search": {
      const query = String(input.payload.query ?? "");
      const result = await notionApiRequest("/v1/search", token, {
        method: "POST",
        body: JSON.stringify({
          query: query.trim() || undefined,
          page_size: Number(input.payload.page_size ?? 10),
        }),
      });
      return { results: (result as { results?: unknown[] }).results ?? [] };
    }

    case "notion.create_page": {
      const parentId = String(input.payload.parent_id ?? "");
      const title = String(input.payload.title ?? "");
      const content = typeof input.payload.content === "string" ? input.payload.content : "";
      if (!parentId.trim() || !title.trim()) {
        throw new Error("input.parent_id and input.title are required");
      }
      const children = content.trim()
        ? [
            {
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: [{ type: "text", text: { content } }],
              },
            },
          ]
        : undefined;
      const page = await notionApiRequest("/v1/pages", token, {
        method: "POST",
        body: JSON.stringify({
          parent: { page_id: parentId },
          properties: {
            title: {
              title: [{ type: "text", text: { content: title } }],
            },
          },
          children,
        }),
      });
      return { page };
    }

    default:
      throw new Error(`Unsupported Notion capability: ${input.capability}`);
  }
}

async function microsoftGraphRequest(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<unknown> {
  const url = path.startsWith("http") ? path : `https://graph.microsoft.com/v1.0${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error?: { message?: string } }).error?.message ?? "Microsoft Graph error")
        : `Microsoft Graph returned ${response.status}`;
    throw new Error(message);
  }
  return data;
}

export function isMicrosoftCapability(name: string): boolean {
  return name.startsWith("microsoft.") || name.startsWith("outlook.");
}

export async function executeMicrosoftCapability(input: {
  capability: string;
  payload: JsonObject;
  accessToken?: string;
}): Promise<unknown> {
  const token = requireAccessToken(input.accessToken, "Microsoft");

  switch (input.capability) {
    case "microsoft.userinfo": {
      const profile = await microsoftGraphRequest("/me", token);
      return { user: profile };
    }

    case "outlook.send_mail": {
      const to = String(input.payload.to ?? "");
      const subject = String(input.payload.subject ?? "");
      const body = String(input.payload.body ?? "");
      if (!to.trim() || !subject.trim()) {
        throw new Error("input.to and input.subject are required");
      }
      await microsoftGraphRequest("/me/sendMail", token, {
        method: "POST",
        body: JSON.stringify({
          message: {
            subject,
            body: { contentType: "Text", content: body },
            toRecipients: [{ emailAddress: { address: to } }],
          },
          saveToSentItems: true,
        }),
      });
      return { sent: true, to, subject };
    }

    default:
      throw new Error(`Unsupported Microsoft capability: ${input.capability}`);
  }
}

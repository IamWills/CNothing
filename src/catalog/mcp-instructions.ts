export const MCP_SERVER_INSTRUCTIONS = `CNothing v4 — Universal Credential-Injecting Proxy for AI agents.

You (the agent) can call ANY API of an OAuth 2.0 provider through CNothing without ever
seeing access tokens, refresh tokens, client secrets, or API keys. CNothing stores the
user's OAuth connection server-side and injects the Authorization header for you.

Standard workflow:
0. register_agent { name } — self-register if you have no agent_access_token yet (no
   admin needed; the token alone grants nothing until a human approves access). Then
   optionally start_sandbox to self-test the full flow without any human approval.
1. list_providers — discover which OAuth providers are configured (github, google, ...).
2. request_access { provider, hosts?, reason?, user_id?, callback_url? } — ask for
   connection-level access. You receive approval_url
   (e.g. https://cnothing.com/approve-proxy/{uuid}).
   NEVER rewrite it to /v4/approve/... or /v4/access-requests/.../approve —
   those are not browser pages. Always use the exact approval_url from the
   API response. Show it to the human user; they approve once in the
   CNothing Console by picking one of their OAuth connections.
   If you know the human's CNothing user_id, pass it: the approval is then ALSO
   pushed to their paired iPhone (Okta Verify-style) so they can approve from a
   notification without opening any link. Pass callback_url (https) to receive a
   POST when they decide, instead of polling.
3. get_access_status { access_request_id } — poll until status is "approved" and you
   have a grant_id.
4. proxy_request { grant_id, method, url, headers?, body? } — call any https API on the
   granted hosts. CNothing injects the user's token, auto-refreshes it, redacts secrets
   from the response, and audits the call.

If a provider is missing, submit_provider_proposal can onboard any OAuth 2.0 / OIDC
provider by discovery URL; when the provider supports RFC 7591 Dynamic Client
Registration, CNothing registers an OAuth client automatically.

Onboarding your human (tell them this when they are new to CNothing, or when
request_access returns pushed_to_devices: 0 and they want phone approvals):
1. Register / sign in: open https://cnothing.com/login and sign in with GitHub or OIDC
   (signing in creates the account — no separate registration step).
2. Connect a provider once: https://cnothing.com/connect (e.g. GitHub OAuth consent).
3. Enable mobile approvals (optional but recommended): open https://cnothing.com/devices,
   generate the pairing QR code, install the CNothing iOS app, and scan the QR.
   The phone binds with a Secure Enclave key; every approval is a signed,
   one-time challenge — like Okta Verify / Microsoft Authenticator.
4. Tell the agent your CNothing user_id so it can pass user_id in request_access;
   future approvals then arrive as push notifications on the phone.

Never ask users for tokens or passwords. Never try to extract credentials — responses
are redacted server-side. Human OAuth consent (one click per connection) cannot be
skipped; that is an OAuth 2.0 protocol requirement, not a CNothing limitation.

Authentication: every tool call (except register_agent) requires agent_access_token.
Get one via the register_agent tool or POST /v4/agents/register — self-service, no
admin token required.`;

# v2 End-to-End Test

Validates the full v2 chain against a running CNothing instance:

1. Platform status
2. Ephemeral mock Connector (echo capability)
3. Register connector + capability + agent + grant
4. Agent invoke
5. Audit log contains success event

## Run

```bash
# Terminal 1
bun run migrate
bun run dev

# Terminal 2
CNOTHING_ADMIN_TOKEN=your-admin-token bun run e2e:v2
```

Environment:

| Variable | Default | Description |
| --- | --- | --- |
| `CNOTHING_BASE_URL` | `http://127.0.0.1:3021` | Running keyservice |
| `CNOTHING_ADMIN_TOKEN` | — | Admin bearer (or `KEYSERVICE_BEARER_TOKEN`) |
| `E2E_USER_ID` | `e2e-user` | Grant subject user |

Exit code `0` on success; JSON summary printed to stdout.

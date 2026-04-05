# Node.js Example

This example shows a minimal Node.js backend using the published `cnothing` package in blind mode.

Formal standard:

- [https://cnothing.com/standards/authentication/1.0](https://cnothing.com/standards/authentication/1.0)

## Install

```bash
cd examples/node-server
npm install
```

## Run

```bash
CNOTHING_PRIVACY_KEY=replace-me \
node index.mjs
```

Optional environment variables:

- `CNOTHING_BASE_URL`
- `CNOTHING_CLIENT_PRIVATE_KEY_PEM`
- `CNOTHING_CLIENT_PUBLIC_KEY_PEM`
- `CNOTHING_CLIENT_LABEL`
- `CNOTHING_NAMESPACE`
- `CNOTHING_KEY`
- `CNOTHING_SECRET_VALUE`

If you do not provide a key pair, the example generates one locally for the process.

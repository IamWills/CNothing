# cnothing-deepseek

DeepSeek Harness bundle for CNothing v4. The plugin holds enrollment state; tool results only include `approval_url` and `user_code` until the user approves.

Install into a profile after this package is published:

```bash
dsh plugin add cnothing-deepseek
```

From this repository during development:

```bash
dsh web --patch ./agenttools/deepseek-harness/cordis.patch.yml
```

The local patch expects the package name `cnothing-deepseek` to resolve (workspace install or `dsh plugin add ./agenttools/deepseek-harness`).

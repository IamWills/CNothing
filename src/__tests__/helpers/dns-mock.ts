import { mock } from "bun:test";

/**
 * Shared so every suite in the process agrees on one DNS policy: hosts under
 * `.internal.test` resolve to a link-local address (for rebinding cases) and
 * everything else resolves to a public one. Import this before importing any
 * module that performs URL safety checks.
 */
export const PRIVATE_TEST_HOST = "rebind.internal.test";

const lookup = async (hostname: string) =>
  hostname.endsWith(".internal.test")
    ? [{ address: "169.254.169.254", family: 4 }]
    : [{ address: "140.82.121.5", family: 4 }];

mock.module("node:dns/promises", () => ({ lookup, default: { lookup } }));

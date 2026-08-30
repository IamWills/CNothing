import { createMcpAgent, handleMcpMessage, type JsonRpcRequest } from "./server";

const agent = createMcpAgent();

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

function respondError(id: string | number | null, code: number, message: string): void {
  write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }));
}

let buffer = "";
let queue: Promise<void> = Promise.resolve();
process.stdin.on("data", (chunk: Buffer) => {
  buffer += chunk.toString("utf8");
  let newline = buffer.indexOf("\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line) {
      try {
        const rpc = JSON.parse(line) as JsonRpcRequest;
        queue = queue.then(() => handleMcpMessage(rpc, { agent, write }));
      } catch {
        respondError(null, -32700, "Parse error");
      }
    }
    newline = buffer.indexOf("\n");
  }
});
process.stdin.on("end", () => void queue.then(() => process.exit(0)));

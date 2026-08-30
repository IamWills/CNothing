import {
  AGENT_TOOLS,
  createCNothingAgent,
  renderModelJson,
  type AgentToolName,
  type CNothingAgent,
} from "cnothing-agent";

import { defineTool } from "./define-tool";
import type { Context, ToolDefinition } from "./dsh-types";

export const name = "cnothing";
export const inject = ["tools"];

export function createCNothingTools(agent: CNothingAgent): ToolDefinition[] {
  return AGENT_TOOLS.map((tool) =>
    defineTool({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      output: {
        schema: { type: "object" },
        render: (_args, value) => [{ type: "text", text: renderModelJson(value) }],
      },
      async execute(args) {
        return agent.invoke(tool.name as AgentToolName, args ?? {});
      },
    }),
  );
}

export function apply(ctx: Context): void {
  const agent = createCNothingAgent({
    clientName: process.env.CNOTHING_CLIENT_NAME?.trim() || "cnothing-deepseek",
    softwareId: "cnothing-deepseek",
  });
  for (const tool of createCNothingTools(agent)) {
    ctx.tools.register(tool);
  }
}

import type { ToolDefinition } from "./dsh-types";

/**
 * Identity wrapper matching DeepSeek `defineTool`. When the harness is
 * installed, `ctx.tools.register` still accepts this ToolDefinition shape.
 */
export function defineTool(definition: ToolDefinition): ToolDefinition {
  return definition;
}

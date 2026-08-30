export type TextContent = { type: "text"; text: string };

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  output: {
    schema: unknown;
    render: (args: unknown, value: unknown) => TextContent[];
  };
  execute: (args: Record<string, unknown>) => Promise<unknown>;
};

export type ToolsService = {
  register: (definition: ToolDefinition) => () => void;
};

export type Context = {
  tools: ToolsService;
};

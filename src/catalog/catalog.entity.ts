export type McpToolDescriptor = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type McpResourceDescriptor = {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
};

export type SkillCatalogEntry = {
  id: string;
  name: string;
  description: string;
  file_path: string;
  body_markdown: string;
};

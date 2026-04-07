export type McpToolDescriptor = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  useCases?: string[];
  examples?: Array<Record<string, unknown>>;
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
  slug: string;
  file_path: string;
  public_path: string;
  markdown_path: string;
  body_markdown: string;
};

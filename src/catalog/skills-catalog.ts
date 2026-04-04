import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { SkillCatalogEntry } from "./catalog.entity";

function walkDirectory(root: string): string[] {
  const entries = readdirSync(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const nextPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDirectory(nextPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(nextPath);
    }
  }

  return files;
}

function parseFrontmatter(markdown: string): { name: string; description: string } {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return { name: "unknown", description: "" };
  }

  const lines = match[1].split("\n");
  const values: Record<string, string> = {};
  for (const line of lines) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex < 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    values[key] = value.replace(/^"|"$/g, "");
  }

  return {
    name: values.name ?? "unknown",
    description: values.description ?? "",
  };
}

export function listSkillCatalogEntries(): SkillCatalogEntry[] {
  const skillsDir = path.resolve(process.cwd(), "skills");
  let files: string[] = [];

  try {
    files = walkDirectory(skillsDir).filter((file) => file.endsWith("SKILL.md"));
  } catch {
    return [];
  }

  return files
    .sort()
    .map((filePath) => {
      const markdown = readFileSync(filePath, "utf8");
      const frontmatter = parseFrontmatter(markdown);
      return {
        id: path.relative(skillsDir, filePath).replace(/\\/g, "/"),
        name: frontmatter.name,
        description: frontmatter.description,
        file_path: path.relative(process.cwd(), filePath).replace(/\\/g, "/"),
        body_markdown: markdown,
      };
    });
}

import { readFile } from "node:fs/promises";
import { readdirSync } from "node:fs";
import path from "node:path";

export type PublicSkillEntry = {
  id: string;
  slug: string;
  name: string;
  description: string;
  filePath: string;
  markdown: string;
  publicPath: string;
  markdownPath: string;
};

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

  const values: Record<string, string> = {};
  const frontmatterBlock = match[1] ?? "";

  for (const line of frontmatterBlock.split("\n")) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex < 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    values[key] = value.replace(/^"|"$/g, "");
  }

  return {
    name: values.name ?? "unknown",
    description: values.description ?? "",
  };
}

function getSkillsDir() {
  return path.resolve(process.cwd(), "..", "skills");
}

export async function listPublicSkills(): Promise<PublicSkillEntry[]> {
  const skillsDir = getSkillsDir();
  const files = walkDirectory(skillsDir).filter((file) => file.endsWith("SKILL.md")).sort();

  return Promise.all(
    files.map(async (filePath) => {
      const markdown = await readFile(filePath, "utf8");
      const relativePath = path.relative(skillsDir, filePath).replace(/\\/g, "/");
      const slug = relativePath.replace(/\/SKILL\.md$/, "");
      const frontmatter = parseFrontmatter(markdown);

      return {
        id: relativePath,
        slug,
        name: frontmatter.name,
        description: frontmatter.description,
        filePath: path.relative(path.resolve(process.cwd(), ".."), filePath).replace(/\\/g, "/"),
        markdown,
        publicPath: `/skills#${slug}`,
        markdownPath: `/skills/markdown/${slug}`,
      };
    }),
  );
}

export async function getPublicSkillBySlug(slugSegments: string[]): Promise<PublicSkillEntry | null> {
  const targetSlug = slugSegments.join("/");
  const skills = await listPublicSkills();
  return skills.find((skill) => skill.slug === targetSlug) ?? null;
}

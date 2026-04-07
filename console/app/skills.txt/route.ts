import { listPublicSkills } from "@/lib/public-skills";

export async function GET() {
  const skills = await listPublicSkills();

  const lines = [
    "# CNothing Skills Directory",
    "",
    "Discovery endpoints:",
    "- /.well-known/mcp",
    "- /skills/index.json",
    "- /getting-started.md",
    "- /skill.md",
    "- /standards",
    "",
    "Bundled skills:",
    ...skills.flatMap((skill) => [
      `- ${skill.name}`,
      `  slug: ${skill.slug}`,
      `  markdown: ${skill.markdownPath}`,
      `  anchor: ${skill.publicPath}`,
      `  description: ${skill.description}`,
    ]),
    "",
  ];

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=60",
    },
  });
}

import { listPublicSkills } from "@/lib/public-skills";

export async function GET() {
  const skills = await listPublicSkills();

  const lines = [
    "# CNothing Skills Directory (v4 only)",
    "",
    "Primary skill for all agents:",
    "- https://cnothing.com/skill.md",
    "- https://cnothing.com/getting-started.md",
    "",
    "Discovery endpoints:",
    "- /.well-known/mcp",
    "- /mcp",
    "- /mcp/manifest",
    "- /skills/index.json",
    "- /openapi-v4.json",
    "",
    "Do NOT use AuthAI, KV envelopes, /authorize/{id}, /v2/*, or /v3/*.",
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

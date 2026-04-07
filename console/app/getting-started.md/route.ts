import { getPublicSkillBySlug } from "@/lib/public-skills";

export async function GET() {
  const skill = await getPublicSkillBySlug(["cnothing-getting-started"]);

  if (!skill) {
    return new Response("Getting started skill not found", { status: 404 });
  }

  return new Response(skill.markdown, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=60",
    },
  });
}

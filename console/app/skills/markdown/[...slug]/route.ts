import { getPublicSkillBySlug } from "@/lib/public-skills";

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string[] }> },
) {
  const { slug } = await context.params;
  const skill = await getPublicSkillBySlug(slug);

  if (!skill) {
    return new Response("Skill not found", { status: 404 });
  }

  return new Response(skill.markdown, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=60",
    },
  });
}

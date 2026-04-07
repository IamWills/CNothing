import { listPublicSkills } from "@/lib/public-skills";

export async function GET() {
  const skills = await listPublicSkills();

  return Response.json({
    ok: true,
    generated_at: new Date().toISOString(),
    items: skills.map((skill) => ({
      id: skill.id,
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      file_path: skill.filePath,
      public_path: skill.publicPath,
      markdown_path: skill.markdownPath,
    })),
  });
}

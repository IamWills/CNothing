import { SkillsPage } from "@/components/console/skills-page";
import { listPublicSkills } from "@/lib/public-skills";

export default async function Skills() {
  const skills = await listPublicSkills();
  return <SkillsPage skills={skills} />;
}

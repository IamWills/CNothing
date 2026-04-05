import { readFile } from "node:fs/promises";
import path from "node:path";
import { ReadmePage } from "@/components/console/readme-page";

export default async function Readme() {
  const readmePath = path.resolve(process.cwd(), "..", "README.md");
  const readme = await readFile(readmePath, "utf8");

  return <ReadmePage readme={readme} />;
}

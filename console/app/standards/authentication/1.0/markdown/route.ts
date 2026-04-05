import { authStandard, renderAuthStandardMarkdown } from "@/lib/auth-standard";

export function GET() {
  return new Response(renderAuthStandardMarkdown(), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `inline; filename="cnothing-authentication-standard-v${authStandard.version}.md"`,
    },
  });
}

import {
  registrationHubStandard,
  renderRegistrationHubStandardMarkdown,
} from "@/lib/auth-standard";

export function GET() {
  return new Response(renderRegistrationHubStandardMarkdown(), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `inline; filename="cnothing-registration-hub-standard-v${registrationHubStandard.version}.md"`,
    },
  });
}

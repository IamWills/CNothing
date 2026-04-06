import {
  registrationHubStandard,
  renderRegistrationHubStandardHtmlDocument,
} from "@/lib/auth-standard";

export function GET() {
  return new Response(renderRegistrationHubStandardHtmlDocument(), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-disposition": `inline; filename="cnothing-registration-hub-standard-v${registrationHubStandard.version}.html"`,
    },
  });
}

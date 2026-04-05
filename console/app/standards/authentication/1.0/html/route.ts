import { authStandard, renderAuthStandardHtmlDocument } from "@/lib/auth-standard";

export function GET() {
  return new Response(renderAuthStandardHtmlDocument(), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-disposition": `inline; filename="cnothing-authentication-standard-v${authStandard.version}.html"`,
    },
  });
}

import { registrationHubStandard } from "@/lib/auth-standard";
import { StandardPublicationPage } from "@/components/console/auth-standard-page";

export function RegistrationHubStandardPage() {
  return <StandardPublicationPage standard={registrationHubStandard} />;
}

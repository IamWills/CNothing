import { LoginPage } from "@/components/console/login-page";
import { loadLoginProviders } from "@/lib/internal-api";

export const dynamic = "force-dynamic";

export default async function Login() {
  const initialProviders = await loadLoginProviders();
  return <LoginPage initialProviders={initialProviders} />;
}

import { AuthorizePage } from "@/components/console/authorize-page";

export default async function Authorize({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AuthorizePage requestId={id} />;
}

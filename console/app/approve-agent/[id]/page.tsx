import { ApproveAgentPage } from "@/components/console/approve-agent-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ApproveAgentPage enrollmentId={id} />;
}

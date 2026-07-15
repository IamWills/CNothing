import { ApproveProxyPage } from "@/components/console/approve-proxy-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ApproveProxyPage accessRequestId={id} />;
}

import { Suspense } from "react";
import ApprovalDetailPage from "./approval-detail-client";

export default function Page() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-slate-500">Loading approval…</p>}>
      <ApprovalDetailPage />
    </Suspense>
  );
}

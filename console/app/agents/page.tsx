import { redirect } from "next/navigation";

/** Agents top-nav entry lands on the v3 Dashboard by default. */
export default function Agents() {
  redirect("/dashboard/capabilities" as never);
}

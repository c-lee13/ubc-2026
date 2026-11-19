import { redirect } from "next/navigation";

// Payouts to the shop are automatic on escrow v2; the manual Collect fallback now sits on each
// finished promo in the workspace's History tab.
export default function ClaimsPage() {
  redirect("/merchant");
}

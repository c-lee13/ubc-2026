import { redirect } from "next/navigation";

// The old "Live offers" page is the Coupons tab now.
export default function DiscoverPage() {
  redirect("/?as=customer");
}

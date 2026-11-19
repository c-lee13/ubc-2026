import type { Metadata } from "next";
import { MyPromos } from "@/components/me-view";

export const metadata: Metadata = { title: "My promos: Wincentive" };

export default function MePage() {
  return <MyPromos />;
}

import { TrackOrderPage } from "@/components/track/TrackOrderPage";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Jouw order | BatterijConcept",
  description: "Volg je thuisbatterij-order bij BatterijConcept.",
};

export default function Page() {
  return <TrackOrderPage />;
}

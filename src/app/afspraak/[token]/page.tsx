import { AfspraakManagePage } from "@/components/afspraak/AfspraakManagePage";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Afspraak beheren | Batterijconcept",
};

export default function Page() {
  return <AfspraakManagePage />;
}

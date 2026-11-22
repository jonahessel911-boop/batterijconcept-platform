import type { Metadata } from "next";
import { AfspraakAgendaClient } from "./AfspraakAgendaClient";

export const metadata: Metadata = {
  title: "Zet in je agenda | Batterijconcept",
};

export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <AfspraakAgendaClient token={token} />;
}

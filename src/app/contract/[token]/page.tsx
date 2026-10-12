import type { Metadata } from "next";
import { SignZzpContractFlow } from "@/components/contract/SignZzpContractFlow";

export const metadata: Metadata = {
  title: "Overeenkomst ondertekenen | BatterijConcept",
};

export default async function ContractSignPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <main className="min-h-screen bg-[#F7F8F6]">
      <SignZzpContractFlow token={token} />
    </main>
  );
}

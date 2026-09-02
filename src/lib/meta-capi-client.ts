/** Client-side: fire-and-forget Meta CAPI sync na statuswijziging. */
export function fireMetaCapiSync(leadId: string): void {
  if (!leadId) return;
  void fetch(`/api/leads/${leadId}/meta-capi`, { method: "POST" }).catch(
    () => {
      /* best-effort */
    }
  );
}

import Link from "next/link";

export function WerkenbijShell({
  children,
  wide = false,
  /** Hero buiten de content-container (full-bleed landing). */
  flush = false,
}: {
  children: React.ReactNode;
  wide?: boolean;
  flush?: boolean;
}) {
  return (
    <div className="relative min-h-screen w-full overflow-x-clip bg-[#F2F7F3] text-ink">
      {!flush ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(ellipse_at_top,_rgba(26,138,62,0.14),_transparent_55%),linear-gradient(180deg,#E8F3EB_0%,#F2F7F3_70%)]"
        />
      ) : null}
      <header className="relative z-20 w-full border-b border-green-deeper/10 bg-white/80 backdrop-blur-md">
        <div
          className={
            wide || flush
              ? "mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6"
              : "mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-4 sm:px-6"
          }
        >
          <Link href="/werkenbij" className="min-w-0">
            <p className="font-display text-lg font-bold tracking-tight text-green-deeper sm:text-xl">
              BatterijConcept
            </p>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-green">
              Werken bij
            </p>
          </Link>
          <Link
            href="/werkenbij#vacatures"
            className="shrink-0 rounded-full border border-green-deeper/15 bg-white px-3.5 py-1.5 text-sm font-semibold text-green-deeper transition hover:border-green hover:bg-green-soft"
          >
            Alle vacatures
          </Link>
        </div>
      </header>
      {flush ? (
        <main className="relative z-10 w-full overflow-x-clip">{children}</main>
      ) : (
        <main
          className={
            wide
              ? "relative z-10 mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12"
              : "relative z-10 mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12"
          }
        >
          {children}
        </main>
      )}
      <footer className="relative z-10 border-t border-green-deeper/10 py-8 text-center text-xs text-muted">
        BatterijConcept · Daltonlaan 500, Utrecht
      </footer>
    </div>
  );
}

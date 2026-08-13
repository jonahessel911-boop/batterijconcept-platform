"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CrmTab } from "@/types/database";
import { CrmHeader } from "./CrmHeader";
import { TabNav } from "./TabNav";

export function DetailShell({
  children,
  onRefresh,
  loading,
  activeTab = "leads",
}: {
  children: React.ReactNode;
  onRefresh?: () => void;
  loading?: boolean;
  /** Welke CRM-tab highlighten in de menubalk */
  activeTab?: CrmTab;
}) {
  const router = useRouter();

  function changeTab(tab: CrmTab) {
    if (tab === "leads") router.push("/");
    else router.push(`/?tab=${tab}`);
  }

  async function logout() {
    try {
      await fetch("/api/auth/login", { method: "DELETE" });
    } catch {
      /* ignore */
    }
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="crm-bg min-h-screen">
      <CrmHeader
        onRefresh={onRefresh}
        loading={loading}
        activeTab={activeTab}
        onTabChange={changeTab}
        onLogout={logout}
      />
      <div className="border-b border-line bg-white">
        <div className="mx-auto max-w-[1440px]">
          <TabNav active={activeTab} onChange={changeTab} />
        </div>
      </div>
      <main className="mx-auto max-w-[1440px] px-3 py-4 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}

export function Breadcrumb({
  items,
}: {
  items: { label: string; href?: string }[];
}) {
  return (
    <nav className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted">
      {items.map((item, i) => (
        <span key={`${item.label}-${i}`} className="flex items-center gap-2">
          {i > 0 && <span className="text-line">/</span>}
          {item.href ? (
            <Link href={item.href} className="font-medium hover:text-green-dark">
              {item.label}
            </Link>
          ) : (
            <span className="font-mono text-xs text-green-dark">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function HeroCard({ children }: { children: React.ReactNode }) {
  return (
    <section className="border border-line bg-white p-4 sm:p-8">
      {children}
    </section>
  );
}

export function InfoTile({
  label,
  value,
  accent,
  href,
}: {
  label: string;
  value?: string | null;
  accent?: boolean;
  href?: string;
}) {
  const content = (
    <>
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </p>
      <p
        className={[
          "mt-1 truncate text-sm font-medium",
          accent ? "text-orange" : "text-ink",
          href ? "hover:underline" : "",
        ].join(" ")}
      >
        {value || "—"}
      </p>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="border border-line bg-wash px-4 py-3 transition hover:border-green/40"
      >
        {content}
      </Link>
    );
  }

  return (
    <div className="border border-line bg-wash px-4 py-3">{content}</div>
  );
}

export function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-5 border border-line bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5 sm:py-3.5">
        <h2 className="font-display text-base font-semibold text-ink">{title}</h2>
        {subtitle && (
          <p className="hidden text-xs text-muted sm:block">{subtitle}</p>
        )}
      </div>
      <div className="p-1 sm:p-2">{children}</div>
    </section>
  );
}

export function NotFoundState({
  title,
  backHref,
  backLabel,
  activeTab,
}: {
  title: string;
  backHref: string;
  backLabel: string;
  activeTab?: CrmTab;
}) {
  return (
    <DetailShell activeTab={activeTab}>
      <div className="mx-auto max-w-lg border border-line bg-white py-16 text-center">
        <h1 className="font-display text-2xl font-semibold text-ink">{title}</h1>
        <Link
          href={backHref}
          className="mt-6 inline-flex bg-green px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-dark"
        >
          ← {backLabel}
        </Link>
      </div>
    </DetailShell>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <div className="mt-5">
      <Link
        href={href}
        className="inline-flex items-center gap-2 border border-line bg-white px-4 py-2 text-sm font-medium text-muted transition hover:border-green/40 hover:text-green-dark"
      >
        ← {label}
      </Link>
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CrmTab } from "@/types/database";
import { magTab } from "@/lib/rollen";
import { usesCrmSidebar } from "@/lib/admin-adviseur";
import { useCrmSession } from "@/hooks/useCrmSession";
import { CrmHeader } from "./CrmHeader";
import { TabNav } from "./TabNav";
import { CrmSidebar } from "./CrmSidebar";

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
  const { session, ready, rol, visibleTabs } = useCrmSession();
  const sidebarMode = usesCrmSidebar(session?.email);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem("bc_crm_sidebar_rail_v1") === "1";
    } catch {
      return false;
    }
  });
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);

  function changeTab(tab: CrmTab) {
    if (rol && !magTab(rol, tab)) return;
    if (!rol) return;
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

  const allowedTabs = visibleTabs.map((t) => t.id);

  return (
    <div className="crm-bg min-h-screen">
      <CrmHeader
        onRefresh={onRefresh}
        loading={loading}
        activeTab={activeTab}
        onTabChange={changeTab}
        onLogout={logout}
        tabs={visibleTabs}
        userName={session?.naam}
        showBekijkAls={false}
        hideTabNav={sidebarMode}
        onOpenSidebar={
          sidebarMode ? () => setSidebarMobileOpen(true) : undefined
        }
      />

      <div
        className={
          sidebarMode
            ? "flex w-full flex-1"
            : "mx-auto flex w-full max-w-[1440px]"
        }
      >
        {sidebarMode && ready ? (
          <CrmSidebar
            active={activeTab}
            onChange={changeTab}
            allowedTabs={allowedTabs}
            collapsed={sidebarCollapsed}
            onToggleCollapsed={() => {
              setSidebarCollapsed((v) => {
                const next = !v;
                try {
                  localStorage.setItem(
                    "bc_crm_sidebar_rail_v1",
                    next ? "1" : "0"
                  );
                } catch {
                  /* ignore */
                }
                return next;
              });
            }}
            mobileOpen={sidebarMobileOpen}
            onMobileClose={() => setSidebarMobileOpen(false)}
          />
        ) : null}

        <div className="min-w-0 flex-1">
          {!sidebarMode ? (
            <div className="border-b border-line bg-white">
              {ready && visibleTabs.length > 0 ? (
                <TabNav
                  active={activeTab}
                  onChange={changeTab}
                  tabs={visibleTabs}
                />
              ) : (
                <div className="hidden h-11 md:block" aria-hidden />
              )}
            </div>
          ) : null}
          <main className="px-3 py-4 sm:px-6 sm:py-8">{children}</main>
        </div>
      </div>
    </div>
  );
}

export function Breadcrumb({
  items,
}: {
  items: { label: string; href?: string }[];
}) {
  return (
    <nav className="flex flex-wrap items-center gap-2 text-sm text-muted">
      {items.map((item, i) => (
        <span key={`${item.label}-${i}`} className="flex items-center gap-2">
          {i > 0 && <span className="text-line">/</span>}
          {item.href ? (
            <Link href={item.href} className="font-medium hover:text-green-dark">
              {item.label}
            </Link>
          ) : (
            <span className="font-mono text-xs text-green-dark">
              {item.label}
            </span>
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
        <h2 className="font-display text-base font-semibold text-ink">
          {title}
        </h2>
        {subtitle ? (
          <p className="hidden text-xs text-muted sm:block">{subtitle}</p>
        ) : null}
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
        <h1 className="font-display text-2xl font-semibold text-ink">
          {title}
        </h1>
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
      <TerugButton fallbackHref={href} label={label} />
    </div>
  );
}

const CRM_RETURN_KEY = "bc_crm_return_url";

/** Onthoud de CRM-lijst-URL zodat detailpagina's terug kunnen naar de juiste tab. */
export function rememberCrmReturnUrl(url?: string) {
  if (typeof window === "undefined") return;
  try {
    const value =
      url ?? `${window.location.pathname}${window.location.search}`;
    if (value.startsWith("/")) {
      sessionStorage.setItem(CRM_RETURN_KEY, value);
    }
  } catch {
    /* ignore */
  }
}

function readCrmReturnUrl(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = sessionStorage.getItem(CRM_RETURN_KEY);
    return v && v.startsWith("/") ? v : null;
  } catch {
    return null;
  }
}

/**
 * Terug naar de vorige CRM-lijst (juiste tab/filters via history),
 * met fallback naar de standaard lijst-URL.
 */
export function TerugButton({
  fallbackHref,
  label = "Terug",
}: {
  fallbackHref: string;
  label?: string;
}) {
  const router = useRouter();

  function goBack() {
    if (typeof window === "undefined") {
      router.push(fallbackHref);
      return;
    }

    const saved = readCrmReturnUrl();
    if (saved) {
      router.push(saved);
      return;
    }

    if (window.history.length > 1) {
      router.back();
      return;
    }

    router.push(fallbackHref);
  }

  return (
    <button
      type="button"
      onClick={goBack}
      className="border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink transition hover:border-green/40 hover:bg-wash"
    >
      ← {label}
    </button>
  );
}

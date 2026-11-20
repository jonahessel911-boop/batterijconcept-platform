"use client";

import { useState, type ReactNode } from "react";
import { Check, ChevronDown, Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export type FlowGedaanItem = {
  key: string;
  label: string;
};

export type ContextRegel = {
  key: string;
  label: string;
  value: string;
  copyValue?: string | null;
  /** Lange tekst (oplever-notitie) onder het label i.p.v. op één regel. */
  wide?: boolean;
};

export type ContextBlock = {
  key: string;
  titel: string;
  meta?: string | null;
  done?: boolean;
  regels: ContextRegel[];
  /** Ingeklapt tot je hem opent (schouwformulier bij installatie plannen). */
  collapsible?: boolean;
  defaultOpen?: boolean;
  pdfUrl?: string | null;
};

function Fact({
  label,
  value,
  copyValue,
  copied,
  onCopy,
}: {
  label: string;
  value: ReactNode;
  copyValue?: string | null;
  copied?: boolean;
  onCopy?: () => void;
}) {
  const text = (copyValue || "").trim();
  const canCopy = Boolean(text && onCopy);
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium text-muted-foreground">{label}</p>
      <div className="flex min-w-0 items-center gap-0.5">
        <p className="min-w-0 truncate text-sm font-medium leading-snug text-foreground">
          {value || "—"}
        </p>
        {canCopy ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0"
            title={copied ? "Gekopieerd" : `Kopieer ${label.toLowerCase()}`}
            aria-label={copied ? "Gekopieerd" : `Kopieer ${label.toLowerCase()}`}
            onClick={onCopy}
          >
            {copied ? (
              <Check className="size-3.5 text-primary" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ContextBlockCard({
  block,
  copiedKey,
  onCopy,
}: {
  block: ContextBlock;
  copiedKey: string | null;
  onCopy: (key: string, value: string) => void;
}) {
  const header = (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
      <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-foreground">
        {block.done ? (
          <Check className="size-4 shrink-0 text-primary" aria-hidden />
        ) : null}
        <span className="truncate">{block.titel}</span>
      </p>
      <span className="flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground">
        {block.meta || null}
        {block.collapsible ? (
          <ChevronDown className="size-3.5 transition-transform [[data-panel-open]_&]:rotate-180" />
        ) : null}
      </span>
    </div>
  );

  const body = (
    <>
      {block.regels.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5">
          {block.regels.map((r) => (
            <li
              key={r.key}
              className={
                r.wide
                  ? "flex flex-col gap-0.5 text-[13px]"
                  : "flex items-center justify-between gap-2 text-[13px]"
              }
            >
              <span className="text-muted-foreground">{r.label}</span>
              <span
                className={
                  r.wide
                    ? "whitespace-pre-wrap font-medium leading-snug text-foreground"
                    : "flex items-center gap-0.5 font-medium tabular-nums text-foreground"
                }
              >
                {r.value}
                {r.copyValue ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    title={
                      copiedKey === r.key
                        ? "Gekopieerd"
                        : `Kopieer ${r.label.toLowerCase()}`
                    }
                    aria-label={
                      copiedKey === r.key
                        ? "Gekopieerd"
                        : `Kopieer ${r.label.toLowerCase()}`
                    }
                    onClick={() => onCopy(r.key, r.copyValue || r.value)}
                  >
                    {copiedKey === r.key ? (
                      <Check className="size-3.5 text-primary" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {block.pdfUrl ? (
        <a
          href={block.pdfUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-wash"
        >
          <Download className="size-3.5" />
          Download PDF
        </a>
      ) : null}
    </>
  );

  const shell =
    "rounded-lg border border-border bg-wash/40 px-3 py-2";

  if (!block.collapsible) {
    return (
      <div className={shell}>
        {header}
        {body}
      </div>
    );
  }

  return (
    <Collapsible defaultOpen={Boolean(block.defaultOpen)} className={shell}>
      <CollapsibleTrigger className="flex w-full items-center text-left">
        {header}
      </CollapsibleTrigger>
      <CollapsibleContent>{body}</CollapsibleContent>
    </Collapsible>
  );
}

export function ActieFocusLayout({
  taakTitel,
  taakWaarom,
  nodig,
  flowGedaan,
  contextBlocks,
  telefoon,
  email,
  adres,
  statusLabel,
  schouwLabel,
  installatieLabel,
  rail,
}: {
  taakTitel: string;
  taakWaarom?: string | null;
  nodig?: ReactNode | null;
  flowGedaan: FlowGedaanItem[];
  contextBlocks?: ContextBlock[];
  telefoon?: string | null;
  email?: string | null;
  adres?: string | null;
  statusLabel?: string | null;
  schouwLabel?: string | null;
  installatieLabel?: string | null;
  rail?: ReactNode;
}) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  function copy(key: string, value: string) {
    const text = value.trim();
    if (!text) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((cur) => (cur === key ? null : cur));
      }, 1500);
    });
  }

  const blocks = contextBlocks?.filter((b) => b.regels.length > 0 || b.titel) ?? [];

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden p-3 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)]">
      <Card
        size="sm"
        className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-card"
      >
        <CardContent className="shrink-0 border-b py-2.5">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
            <Fact
              label="Telefoon"
              value={telefoon}
              copyValue={telefoon}
              copied={copiedKey === "telefoon"}
              onCopy={() => copy("telefoon", telefoon || "")}
            />
            <Fact
              label="E-mail"
              value={email}
              copyValue={email}
              copied={copiedKey === "email"}
              onCopy={() => copy("email", email || "")}
            />
            <Fact
              label="Adres"
              value={adres}
              copyValue={adres}
              copied={copiedKey === "adres"}
              onCopy={() => copy("adres", adres || "")}
            />
            <Fact label="Status" value={statusLabel} />
            <Fact label="Schouw" value={schouwLabel} />
            <Fact label="Installatie" value={installatieLabel} />
          </div>
        </CardContent>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {blocks.length > 0 ? (
            <div className="space-y-2 border-b px-4 py-3">
              {blocks.map((b) => (
                <ContextBlockCard
                  key={b.key}
                  block={b}
                  copiedKey={copiedKey}
                  onCopy={copy}
                />
              ))}
            </div>
          ) : null}

          {flowGedaan.length > 0 ? (
            <ul className="flex flex-wrap gap-x-3 gap-y-1 px-4 pt-2.5">
              {flowGedaan.map((s) => (
                <li
                  key={s.key}
                  className="flex items-center gap-1 text-[12px] text-muted-foreground"
                >
                  <Check className="size-3.5 shrink-0 text-primary" aria-hidden />
                  <span>{s.label}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <CardHeader className="space-y-1 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Nu
            </p>
            <CardTitle className="text-base leading-tight">{taakTitel}</CardTitle>
            {taakWaarom ? (
              <p className="whitespace-pre-wrap text-sm leading-snug text-muted-foreground">
                {taakWaarom}
              </p>
            ) : null}
          </CardHeader>

          {nodig ? <CardContent className="pb-3">{nodig}</CardContent> : null}
        </div>
      </Card>

      <Card
        size="sm"
        className="flex min-h-0 flex-col overflow-hidden bg-card"
      >
        <CardHeader className="shrink-0 border-b py-2">
          <CardTitle className="text-sm">Wat je nu kunt doen</CardTitle>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 space-y-2 overflow-y-auto py-3">
          {rail}
        </CardContent>
      </Card>
    </div>
  );
}

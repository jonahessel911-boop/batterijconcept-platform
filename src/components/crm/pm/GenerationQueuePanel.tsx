"use client";

import { useEffect, useRef, useState } from "react";
import type { CreativeLibraryItem } from "@/lib/performance-marketing";

export type QueueJob = {
  id: string;
  libraryItemId: string;
  status: "pending" | "running" | "done" | "failed";
  media?: "image" | "video";
  cardboardText?: string;
  fileStem?: string;
  error?: string | null;
};

export type QueueSummary = {
  pending: number;
  running: number;
  done: number;
  failed: number;
  items: QueueJob[];
};

type Props = {
  /** Force open / highlight after a generate click */
  highlight?: boolean;
  onQueueChange?: (q: QueueSummary) => void;
  onRefreshLibrary?: (items?: CreativeLibraryItem[]) => void;
};

function labelFor(job: QueueJob): string {
  const fromCard = job.cardboardText
    ?.split("\n")
    .find((l) => /^IN\s+/i.test(l.trim()));
  if (fromCard) return fromCard.trim();
  const m = job.libraryItemId.match(/-vid-([a-z0-9-]+)-/i);
  if (m?.[1]) return m[1].replace(/-/g, " ");
  const s = job.fileStem || job.id;
  return s.slice(0, 36);
}

export function GenerationQueuePanel({
  highlight,
  onQueueChange,
  onRefreshLibrary,
}: Props) {
  const [queue, setQueue] = useState<QueueSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [processMsg, setProcessMsg] = useState<string | null>(null);
  const processing = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function processStillsIfNeeded(q: QueueSummary) {
      const pendingImages = q.items.filter(
        (i) => (i.media || "image") === "image" && i.status === "pending"
      ).length;
      if (pendingImages === 0 || processing.current) return;
      processing.current = true;
      try {
        const res = await fetch("/api/performance-marketing/library", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "process_generation_queue",
            media: "image",
            limit: 2,
          }),
        });
        const json = (await res.json()) as {
          error?: string;
          message?: string;
          library?: { items: CreativeLibraryItem[] };
          queue?: QueueSummary;
        };
        if (!cancelled) {
          if (!res.ok) setProcessMsg(json.error || "Still-render mislukt");
          else {
            setProcessMsg(json.message || null);
            if (json.queue) setQueue(json.queue);
            if (json.library?.items) onRefreshLibrary?.(json.library.items);
          }
        }
      } catch (e) {
        if (!cancelled) {
          setProcessMsg(e instanceof Error ? e.message : "Process fout");
        }
      } finally {
        processing.current = false;
      }
    }

    async function tick() {
      try {
        const res = await fetch(
          "/api/performance-marketing/library?queue=1",
          { cache: "no-store" }
        );
        const json = (await res.json()) as {
          error?: string;
          queue?: QueueSummary;
        };
        if (!res.ok) throw new Error(json.error || "Queue laden mislukt");
        if (cancelled) return;
        const q = json.queue || {
          pending: 0,
          running: 0,
          done: 0,
          failed: 0,
          items: [],
        };
        setQueue(q);
        setErr(null);
        onQueueChange?.(q);

        const active = q.pending + q.running;
        if (active > 0) {
          onRefreshLibrary?.();
          await processStillsIfNeeded(q);
          timer = setTimeout(tick, 2000);
        }
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "Queue fout");
          timer = setTimeout(tick, 5000);
        }
      }
    }

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [highlight, onQueueChange, onRefreshLibrary]);

  const active = (queue?.pending || 0) + (queue?.running || 0);
  const failedJobs = queue?.items.filter((i) => i.status === "failed") || [];
  const showFailed = (queue?.failed || 0) > 0 && active === 0;

  if (!queue && !err) return null;
  if (active === 0 && !highlight && !err && !showFailed) return null;

  return (
    <div
      className={[
        "rounded-2xl border px-4 py-3 shadow-sm",
        active > 0
          ? "border-green-dark/40 bg-[#F3F8F4]"
          : err || showFailed
            ? "border-[#C45A12]/40 bg-[#FFF0E6]"
            : "border-line bg-white",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink">
            {active > 0 ? (
              <>
                <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-green-dark" />
                Bezig met maken — {active} in queue
              </>
            ) : err ? (
              "Queue kon niet laden"
            ) : showFailed ? (
              "Generatie gestopt / mislukt"
            ) : (
              "Generatie klaar"
            )}
          </p>
          <p className="mt-0.5 text-[11px] text-muted">
            {processMsg ||
              (active > 0
                ? "Stills renderen automatisch via OpenAI. Video’s via Higgsfield (credits)."
                : err ||
                  (showFailed
                    ? "Zie fouten hieronder — vaak Higgsfield zonder credits."
                    : "Previews staan onder New creatives."))}
          </p>
        </div>
        <div className="flex gap-3 text-[11px] font-semibold text-muted">
          <span>wacht {queue?.pending ?? 0}</span>
          <span>bezig {queue?.running ?? 0}</span>
          <span>klaar {queue?.done ?? 0}</span>
          {(queue?.failed ?? 0) > 0 ? (
            <span className="text-[#C45A12]">fout {queue?.failed}</span>
          ) : null}
        </div>
      </div>

      {queue && (queue.items.length > 0 || failedJobs.length > 0) ? (
        <ul className="mt-3 max-h-48 space-y-1.5 overflow-auto">
          {[...queue.items, ...failedJobs.filter((f) => !queue.items.some((i) => i.id === f.id))]
            .slice(0, 20)
            .map((job) => (
            <li
              key={job.id}
              className="flex items-center justify-between gap-2 rounded-lg bg-white/80 px-2.5 py-1.5 text-xs"
            >
              <span className="min-w-0 truncate font-semibold text-ink">
                {job.media === "video" ? "🎬" : "🖼️"} {labelFor(job)}
                {job.error ? (
                  <span className="mt-0.5 block truncate text-[10px] font-normal text-[#C45A12]">
                    {job.error}
                  </span>
                ) : null}
              </span>
              <span
                className={[
                  "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                  job.status === "running"
                    ? "bg-green-dark text-white"
                    : job.status === "failed"
                      ? "bg-[#C45A12] text-white"
                      : "bg-wash text-muted",
                ].join(" ")}
              >
                {job.status === "pending"
                  ? "in wachtrij"
                  : job.status === "running"
                    ? "maakt…"
                    : job.status}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

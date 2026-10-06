"use client";

import { useEffect, useRef, useState } from "react";
import type { ProposedAction } from "@/lib/ai/proposed-actions";

type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolsUsed?: string[];
  proposedActions?: ProposedAction[];
};

function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className || "h-5 w-5"}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
      <path d="M12 18v3" />
      <path d="M8 21h8" />
    </svg>
  );
}

function StopIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className || "h-5 w-5"}
      fill="currentColor"
      aria-hidden
    >
      <rect x="7" y="7" width="10" height="10" rx="1" />
    </svg>
  );
}

function ActionCard({
  action,
  onDone,
}: {
  action: ProposedAction;
  onDone: (ok: string) => void;
}) {
  const [draft, setDraft] = useState(action);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      if (draft.kind === "plan_schouw") {
        const at = draft.schouw_at;
        if (!at) throw new Error("Kies een datum en tijd");
        const res = await fetch(`/api/projecten/${draft.project_id}/schouw`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schouw_at: at,
            installatie_partner_id: draft.partner_id || null,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Inplannen mislukt");
        setDone(true);
        onDone(`Schouw gepland voor ${draft.klant}.`);
        return;
      }
      if (draft.kind === "plan_installatie") {
        const at = draft.installatie_at;
        if (!at) throw new Error("Kies een datum en tijd");
        const res = await fetch(
          `/api/projecten/${draft.project_id}/installatie`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              installatie_at: at,
              installatie_partner_id: draft.partner_id || undefined,
            }),
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Inplannen mislukt");
        setDone(true);
        onDone(`Installatie gepland voor ${draft.klant}.`);
        return;
      }
      if (!draft.to?.trim()) throw new Error("Vul een e-mailadres in");
      if (!draft.subject?.trim()) throw new Error("Vul een onderwerp in");
      if (!draft.bericht?.trim()) throw new Error("Vul de mailtekst in");
      const res = await fetch(
        `/api/projecten/${draft.project_id}/contact-mail`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: draft.to.trim(),
            subject: draft.subject.trim(),
            bericht: draft.bericht.trim(),
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Versturen mislukt");
      setDone(true);
      onDone(`Mail verstuurd naar ${draft.klant}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mislukt");
    } finally {
      setBusy(false);
    }
  }

  const when =
    draft.kind === "plan_schouw"
      ? draft.schouw_at
      : draft.kind === "plan_installatie"
        ? draft.installatie_at
        : null;

  if (done) {
    return (
      <div className="mt-3 border border-green/30 bg-green-soft px-3 py-2 text-xs font-semibold text-green-dark">
        Uitgevoerd
      </div>
    );
  }

  return (
    <div className="mt-3 border border-line bg-wash/50 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
        {draft.kind === "send_mail"
          ? "Mail · preview"
          : draft.kind === "plan_schouw"
            ? "Schouw"
            : "Installatie"}
      </p>
      <p className="mt-0.5 text-sm font-semibold text-ink">
        {draft.klant}
        {draft.project_nummer ? (
          <span className="font-mono text-xs font-medium text-muted">
            {" "}
            · {draft.project_nummer}
          </span>
        ) : null}
      </p>
      {draft.partner_naam ? (
        <p className="text-xs text-muted">Partner: {draft.partner_naam}</p>
      ) : null}
      {draft.warning ? (
        <p className="mt-1 text-xs text-[#C45A12]">{draft.warning}</p>
      ) : null}

      {draft.kind !== "send_mail" ? (
        <label className="mt-2 block text-xs text-muted">
          Datum en tijd
          <input
            type="datetime-local"
            value={toDatetimeLocal(when)}
            onChange={(e) => {
              const v = e.target.value;
              const iso = v ? new Date(v).toISOString() : null;
              setDraft((d) =>
                d.kind === "plan_schouw"
                  ? { ...d, schouw_at: iso }
                  : { ...d, installatie_at: iso }
              );
            }}
            className="mt-1 w-full border border-line bg-white px-2 py-1.5 text-sm text-ink outline-none focus:border-green"
          />
        </label>
      ) : (
        <div className="mt-2 space-y-2">
          <input
            type="email"
            value={draft.to || ""}
            onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
            placeholder="E-mail"
            className="w-full border border-line bg-white px-2 py-1.5 text-sm text-ink outline-none focus:border-green"
          />
          <input
            value={draft.subject || ""}
            onChange={(e) =>
              setDraft((d) => ({ ...d, subject: e.target.value }))
            }
            placeholder="Onderwerp"
            className="w-full border border-line bg-white px-2 py-1.5 text-sm text-ink outline-none focus:border-green"
          />
          <textarea
            value={draft.bericht || ""}
            onChange={(e) =>
              setDraft((d) => ({ ...d, bericht: e.target.value }))
            }
            rows={6}
            className="w-full resize-y border border-line bg-white px-2 py-1.5 text-sm text-ink outline-none focus:border-green"
          />
          <p className="text-[11px] text-muted">
            Versturen gaat via het Batterijconcept-mailtemplate.
          </p>
        </div>
      )}

      {error ? <p className="mt-2 text-xs text-[#C45A12]">{error}</p> : null}

      <button
        type="button"
        disabled={busy}
        onClick={() => void confirm()}
        className="mt-3 bg-orange px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
      >
        {busy
          ? "Bezig…"
          : draft.kind === "send_mail"
            ? "Verstuur"
            : "Plan"}
      </button>
    </div>
  );
}

export function AiPanel() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<"chat" | "listen" | "transcribe" | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    return () => {
      mediaRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function sendText(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    const userMsg: ChatMsg = {
      id: `u-${Date.now()}`,
      role: "user",
      content: trimmed,
    };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setInput("");
    setBusy("chat");
    setError(null);
    setOkMsg(null);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextHistory.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "AI chat mislukt");

      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: data.reply || "—",
          toolsUsed: data.toolsUsed || [],
          proposedActions: data.proposedActions || [],
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI chat mislukt");
    } finally {
      setBusy(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await sendText(input);
  }

  async function startListening() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const recorder = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined
      );
      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        void finishListening();
      };
      mediaRef.current = recorder;
      recorder.start();
      setListening(true);
      setBusy("listen");
    } catch {
      setError("Microfoon niet beschikbaar — geef toestemming in de browser.");
      setBusy(null);
    }
  }

  function stopListening() {
    const rec = mediaRef.current;
    if (rec && rec.state !== "inactive") {
      rec.stop();
    }
    setListening(false);
  }

  async function finishListening() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mediaRef.current = null;

    const chunks = chunksRef.current;
    chunksRef.current = [];
    if (chunks.length === 0) {
      setBusy(null);
      return;
    }

    setBusy("transcribe");
    try {
      const blob = new Blob(chunks, { type: chunks[0]?.type || "audio/webm" });
      const form = new FormData();
      form.append("audio", blob, `whisper-${Date.now()}.webm`);
      const res = await fetch("/api/ai/transcribe", {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Transcriptie mislukt");
      const text = String(data.text || "").trim();
      if (!text) throw new Error("Geen spraak herkend");
      setBusy(null);
      await sendText(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Whisper mislukt");
      setBusy(null);
    }
  }

  function clearChat() {
    setMessages([]);
    setError(null);
    setOkMsg(null);
  }

  return (
    <div className="flex min-h-[calc(100vh-14rem)] flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Backoffice · AI
          </p>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Vraag of spreek in. Acties (schouw, installatie, mail) komen als
            voorstel — jij klikt Plan of Verstuur.
          </p>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={clearChat}
            className="text-xs font-semibold text-muted hover:text-ink"
          >
            Wis chat
          </button>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-5">
        {messages.length === 0 && !busy && (
          <div className="border border-dashed border-line bg-wash/60 px-4 py-8 text-center">
            <p className="font-display text-base font-semibold text-ink">
              Typ of praat
            </p>
            <p className="mt-2 text-sm text-muted">
              Bijv. “Plan de schouw bij Dekkers volgende week donderdag 9 uur”,
              “Stuur Jona Hessel een mail over de schouw”.
            </p>
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={[
              "max-w-3xl px-4 py-3 text-sm leading-relaxed",
              m.role === "user"
                ? "ml-auto bg-green text-white"
                : "mr-auto border border-line bg-white text-ink",
            ].join(" ")}
          >
            <p className="whitespace-pre-wrap">{m.content}</p>
            {m.role === "assistant" &&
              m.proposedActions?.map((a, i) => (
                <ActionCard
                  key={`${m.id}-${i}`}
                  action={a}
                  onDone={(ok) => setOkMsg(ok)}
                />
              ))}
          </div>
        ))}

        {busy === "chat" && (
          <p className="text-sm text-muted">CRM data ophalen…</p>
        )}
        {busy === "listen" && (
          <p className="text-sm font-medium text-[#B71C1C]">
            Opnemen… tik op stop als je klaar bent.
          </p>
        )}
        {busy === "transcribe" && (
          <p className="text-sm text-muted">Spraak omzetten…</p>
        )}
        <div ref={bottomRef} />
      </div>

      {(error || okMsg) && (
        <div className="mx-5 mb-2 space-y-2">
          {error && (
            <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-sm text-[#C45A12]">
              {error}
            </p>
          )}
          {okMsg && (
            <p className="border border-green/30 bg-green-soft px-3 py-2 text-sm text-green-dark">
              {okMsg}
            </p>
          )}
        </div>
      )}

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="sticky bottom-0 border-t border-line bg-white px-4 py-3 md:px-5"
      >
        <div className="flex items-end gap-2">
          <button
            type="button"
            disabled={busy === "chat" || busy === "transcribe"}
            onClick={() =>
              listening ? stopListening() : void startListening()
            }
            title={listening ? "Stop opname" : "Praat"}
            className={[
              "inline-flex h-11 w-11 shrink-0 items-center justify-center border transition",
              listening
                ? "border-[#B71C1C] bg-[#FFEBEE] text-[#B71C1C]"
                : "border-line bg-white text-ink hover:bg-wash",
              "disabled:opacity-50",
            ].join(" ")}
          >
            {listening ? <StopIcon /> : <MicIcon />}
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendText(input);
              }
            }}
            rows={2}
            placeholder="Typ of spreek in…"
            disabled={busy !== null}
            className="min-h-[2.75rem] flex-1 resize-none border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={busy !== null || !input.trim()}
            className="h-11 shrink-0 bg-green px-4 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-50"
          >
            Stuur
          </button>
        </div>
      </form>
    </div>
  );
}

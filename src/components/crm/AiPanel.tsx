"use client";

import { useEffect, useRef, useState } from "react";

type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolsUsed?: string[];
};

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

export function AiPanel() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<"chat" | "listen" | "transcribe" | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
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
  }

  return (
    <div className="flex min-h-[calc(100vh-14rem)] flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Admin only · Whisper + CRM data
          </p>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Vraag alles over leads, agenda, offertes, facturen en meer. Tik op de
            microfoon om te praten — Whisper zet je spraak om en stuurt de vraag
            door.
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
          <div className="rounded-lg border border-dashed border-line bg-wash/60 px-4 py-8 text-center">
            <p className="font-display text-base font-semibold text-ink">
              Stel een vraag of praat
            </p>
            <p className="mt-2 text-sm text-muted">
              Bijv. “Hoeveel afspraken vandaag?”, “Zoek lead Elzinga”, “Welke
              facturen staan open?”
            </p>
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={[
              "max-w-3xl rounded-lg px-4 py-3 text-sm leading-relaxed",
              m.role === "user"
                ? "ml-auto bg-green text-white"
                : "mr-auto border border-line bg-white text-ink",
            ].join(" ")}
          >
            <p className="whitespace-pre-wrap">{m.content}</p>
            {m.role === "assistant" &&
              m.toolsUsed &&
              m.toolsUsed.length > 0 && (
                <p className="mt-2 text-[10px] font-medium uppercase tracking-wide text-muted">
                  Data: {m.toolsUsed.join(" · ")}
                </p>
              )}
          </div>
        ))}

        {busy === "chat" && (
          <p className="text-sm text-muted">CRM data ophalen en antwoorden…</p>
        )}
        {busy === "listen" && (
          <p className="text-sm font-medium text-[#B71C1C]">
            Opnemen… tik op stop als je klaar bent.
          </p>
        )}
        {busy === "transcribe" && (
          <p className="text-sm text-muted">Whisper transcribeert…</p>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="mx-5 mb-2 border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-sm text-[#C45A12]">
          {error}
        </p>
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
            title={listening ? "Stop opname" : "Praat (Whisper)"}
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
            placeholder="Typ je vraag… of gebruik de microfoon"
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

"use client";

import { useEffect, useState } from "react";
import {
  fillRecruitmentTemplate,
  RECRUITMENT_INBOX_TEMPLATES,
} from "@/lib/recruitment-inbox-templates";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";

export type RecruitmentMailTarget = {
  id: string;
  naam: string;
  email: string | null;
  functie?: string | null;
};

function defaultSubject(k: RecruitmentMailTarget) {
  const functie = k.functie?.trim();
  return functie
    ? `${functie} bij BatterijConcept`
    : "BatterijConcept Recruitment";
}

export function RecruitmentKandidaatMailModal({
  kandidaat,
  initialTemplateId = "ontvangen_sollicitatie",
  onClose,
  onSent,
}: {
  kandidaat: RecruitmentMailTarget | null;
  initialTemplateId?: string;
  onClose: () => void;
  onSent?: () => void;
}) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [templateId, setTemplateId] = useState("ontvangen_sollicitatie");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!kandidaat) return;
    const startId =
      RECRUITMENT_INBOX_TEMPLATES.some((t) => t.id === initialTemplateId)
        ? initialTemplateId
        : "ontvangen_sollicitatie";
    const t = RECRUITMENT_INBOX_TEMPLATES.find((x) => x.id === startId);
    setTo(kandidaat.email?.trim() || "");
    setTemplateId(startId);
    setSubject(t?.subject?.trim() || defaultSubject(kandidaat));
    setBody(fillRecruitmentTemplate(t?.body || "", kandidaat.naam));
    setError(null);
    setBusy(false);
  }, [kandidaat, initialTemplateId]);

  function applyTemplate(id: string) {
    setTemplateId(id);
    const t = RECRUITMENT_INBOX_TEMPLATES.find((x) => x.id === id);
    if (!t || !kandidaat) return;
    setBody(fillRecruitmentTemplate(t.body, kandidaat.naam));
    if (t.subject) setSubject(t.subject);
  }

  async function send() {
    if (!kandidaat || busy) return;
    const subjectTrim = subject.trim();
    const bodyTrim = body.trim();
    if (!to.trim() || !subjectTrim || !bodyTrim) {
      setError("Vul aan, onderwerp en bericht in.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/instroom/${encodeURIComponent(kandidaat.id)}/mail`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: to.trim(),
            subject: subjectTrim,
            bodyText: bodyTrim,
            templateId,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Versturen mislukt"
        );
      }
      onSent?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Versturen mislukt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={kandidaat != null}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="z-[80] sm:max-w-lg" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Mail sturen</DialogTitle>
          <DialogDescription>
            {kandidaat
              ? `Vanuit het portaal naar ${kandidaat.naam}. Antwoorden landen in de recruitment-inbox.`
              : "Mail vanuit het portaal."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-1">
          <div className="grid gap-1.5">
            <Label htmlFor="rc-mail-to">Aan</Label>
            <Input
              id="rc-mail-to"
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rc-mail-subject">Onderwerp</Label>
            <Input
              id="rc-mail-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rc-mail-template">Template</Label>
            <NativeSelect
              id="rc-mail-template"
              className="w-full"
              value={templateId}
              onChange={(e) => applyTemplate(e.target.value)}
            >
              {RECRUITMENT_INBOX_TEMPLATES.map((t) => (
                <NativeSelectOption key={t.id} value={t.id}>
                  {t.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rc-mail-body">Bericht</Label>
            <Textarea
              id="rc-mail-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
            />
          </div>
          {error ? (
            <p className="text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onClose}
          >
            Annuleren
          </Button>
          <Button
            type="button"
            disabled={busy || !to.trim() || !subject.trim() || !body.trim()}
            onClick={() => void send()}
          >
            {busy
              ? "Versturen…"
              : templateId === "info_toegestuurd"
                ? "Info toesturen"
                : "Versturen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

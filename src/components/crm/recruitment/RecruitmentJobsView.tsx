"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Briefcase,
  ExternalLink,
  ListChecks,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import type {
  RecruitmentVacature,
  RecruitmentVacatureStatus,
} from "@/types/database";
import {
  RECRUITMENT_ROL_LABEL,
  RECRUITMENT_ROL_OPTIONS,
  isStandardVacatureTitel,
} from "@/lib/recruitment-rollen";
import type { RecruitmentRol } from "@/types/database";
import {
  defaultFormForRol,
  formOrDefault,
  type RecruitmentForm,
} from "@/lib/recruitment-form";
import { RecruitmentFormBuilder } from "@/components/crm/recruitment/RecruitmentFormBuilder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";

function rolLabel(rol: string) {
  if (rol in RECRUITMENT_ROL_LABEL) {
    return RECRUITMENT_ROL_LABEL[rol as RecruitmentRol];
  }
  return rol;
}

type FormState = {
  titel: string;
  rol: string;
  status: RecruitmentVacatureStatus;
  korte_omschrijving: string;
  lander_url: string;
};

const emptyForm = (): FormState => ({
  titel: "",
  rol: "installateur",
  status: "open",
  korte_omschrijving: "",
  lander_url: "",
});

type StatusFilter = "open" | "dicht" | "alle";

export function RecruitmentJobsView({
  onChanged,
}: {
  onChanged?: (openCount: number) => void;
} = {}) {
  const [items, setItems] = useState<RecruitmentVacature[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editIsStandard, setEditIsStandard] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [formEditVac, setFormEditVac] = useState<RecruitmentVacature | null>(
    null
  );
  const [formDraft, setFormDraft] = useState<RecruitmentForm>(
    defaultFormForRol("adviseur_sales")
  );
  const [formSaving, setFormSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/instroom/vacatures");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Vacatures laden mislukt");
      setItems((data.vacatures || []) as RecruitmentVacature[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    onChanged?.(items.filter((v) => v.status === "open").length);
  }, [items, onChanged]);

  function openCreate() {
    setEditId(null);
    setEditIsStandard(false);
    setForm(emptyForm());
    setFormOpen(true);
  }

  function openEdit(v: RecruitmentVacature) {
    setEditId(v.id);
    setEditIsStandard(isStandardVacatureTitel(v.titel));
    setForm({
      titel: v.titel,
      rol: v.rol,
      status: v.status,
      korte_omschrijving: v.korte_omschrijving || "",
      lander_url: v.lander_url || "",
    });
    setFormOpen(true);
  }

  async function saveForm() {
    if (!form.titel.trim()) {
      setError("Titel is verplicht");
      return;
    }
    setBusyId(editId || "new");
    setError(null);
    try {
      const payload = {
        titel: form.titel.trim(),
        rol: form.rol,
        status: form.status,
        korte_omschrijving: form.korte_omschrijving.trim() || null,
        lander_url: form.lander_url.trim() || null,
      };
      const res = await fetch(
        editId
          ? `/api/instroom/vacatures/${encodeURIComponent(editId)}`
          : "/api/instroom/vacatures",
        {
          method: editId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      setFormOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleStatus(v: RecruitmentVacature) {
    const next: RecruitmentVacatureStatus =
      v.status === "open" ? "dicht" : "open";
    setBusyId(v.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/instroom/vacatures/${encodeURIComponent(v.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: next }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Status wijzigen mislukt");
      setItems((list) =>
        list.map((x) => (x.id === v.id ? { ...x, status: next } : x))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Status wijzigen mislukt");
    } finally {
      setBusyId(null);
    }
  }

  function openFormEditor(v: RecruitmentVacature) {
    setFormEditVac(v);
    setFormDraft(formOrDefault(v.form, v.rol));
    setError(null);
  }

  async function saveFormBuilder() {
    if (!formEditVac) return;
    setFormSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/instroom/vacatures/${encodeURIComponent(formEditVac.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ form: formDraft }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Vragen opslaan mislukt");
      const updated = data.vacature as RecruitmentVacature;
      setItems((list) =>
        list.map((x) => (x.id === updated.id ? updated : x))
      );
      setFormEditVac(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Vragen opslaan mislukt");
    } finally {
      setFormSaving(false);
    }
  }

  async function remove(v: RecruitmentVacature) {
    if (isStandardVacatureTitel(v.titel)) return;
    if (!confirm(`Vacature “${v.titel}” verwijderen?`)) return;
    setBusyId(v.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/instroom/vacatures/${encodeURIComponent(v.id)}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Verwijderen mislukt");
      setItems((list) => list.filter((x) => x.id !== v.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verwijderen mislukt");
    } finally {
      setBusyId(null);
    }
  }

  const openCount = items.filter((v) => v.status === "open").length;
  const dichtCount = items.filter((v) => v.status === "dicht").length;
  const standaardCount = items.filter((v) =>
    isStandardVacatureTitel(v.titel)
  ).length;

  const visible = useMemo(() => {
    const list =
      statusFilter === "alle"
        ? items
        : items.filter((v) => v.status === statusFilter);
    return [...list].sort((a, b) => {
      const aStd = isStandardVacatureTitel(a.titel) ? 0 : 1;
      const bStd = isStandardVacatureTitel(b.titel) ? 0 : 1;
      if (aStd !== bStd) return aStd - bStd;
      if (a.status !== b.status) return a.status === "open" ? -1 : 1;
      return a.titel.localeCompare(b.titel, "nl");
    });
  }, [items, statusFilter]);

  const filters: { id: StatusFilter; label: string; count: number }[] = [
    { id: "open", label: "Open", count: openCount },
    { id: "dicht", label: "Dicht", count: dichtCount },
    { id: "alle", label: "Alles", count: items.length },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line px-3 py-3 sm:px-4">
        <div className="min-w-0">
          <p className="text-base font-semibold text-ink">
            Vacatures
            <span className="ml-2 text-sm font-normal text-muted">
              {openCount} open
              {standaardCount > 0 ? ` · ${standaardCount} standaard` : ""}
            </span>
          </p>
          <p className="text-sm text-muted">
            Open/dicht zetten · formulier · publiek op /werkenbij
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/werkenbij"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line px-3 text-sm font-medium text-ink hover:bg-wash"
          >
            Site
            <ExternalLink className="size-3.5" />
          </a>
          <Button type="button" size="sm" className="h-9" onClick={openCreate}>
            <Plus className="size-4" />
            Vacature
          </Button>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-wash/40 px-3 py-2 sm:px-4">
        {filters.map((f) => {
          const active = statusFilter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setStatusFilter(f.id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition",
                active
                  ? "bg-white text-ink shadow-sm ring-1 ring-line"
                  : "text-muted hover:text-ink"
              )}
            >
              {f.label}
              <span className="ml-1.5 tabular-nums opacity-70">{f.count}</span>
            </button>
          );
        })}
      </div>

      {error ? (
        <div className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-3/4" />
          </div>
        ) : items.length === 0 ? (
          <div className="px-6 py-12">
            <Empty className="border-0 p-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Briefcase />
                </EmptyMedia>
                <EmptyTitle>Nog geen vacatures</EmptyTitle>
                <EmptyDescription>
                  Voeg een open rol toe voor campagnes en snelle check.
                </EmptyDescription>
              </EmptyHeader>
              <Button type="button" onClick={openCreate}>
                <Plus className="size-4" />
                Vacature toevoegen
              </Button>
            </Empty>
          </div>
        ) : visible.length === 0 ? (
          <p className="px-4 py-10 text-center text-base text-muted">
            Geen vacatures in dit filter.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {visible.map((v) => {
              const standaard = isStandardVacatureTitel(v.titel);
              const busy = busyId === v.id;
              const rol = rolLabel(v.rol);
              const showRol = rol.toLowerCase() !== v.titel.toLowerCase();
              const isOpen = v.status === "open";
              const vraagCount = formOrDefault(v.form, v.rol).steps.length;
              return (
                <li
                  key={v.id}
                  className={cn(
                    "px-3 py-4 transition sm:px-5",
                    !isOpen && "bg-wash/30"
                  )}
                >
                  <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center xl:gap-6">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-lg font-semibold tracking-tight text-ink">
                          {v.titel}
                        </p>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold",
                            isOpen
                              ? "bg-green-soft text-green-deeper"
                              : "bg-[#e8ebe9] text-muted"
                          )}
                        >
                          {isOpen ? "Open" : "Dicht"}
                        </span>
                        {standaard ? (
                          <span className="text-xs font-medium text-muted">
                            Standaard
                          </span>
                        ) : null}
                        {showRol ? (
                          <span className="text-sm text-muted">{rol}</span>
                        ) : null}
                        <span className="text-xs tabular-nums text-muted">
                          {vraagCount}{" "}
                          {vraagCount === 1 ? "vraag" : "vragen"}
                        </span>
                      </div>
                      {v.korte_omschrijving ? (
                        <p className="mt-1 max-w-2xl text-sm text-muted">
                          {v.korte_omschrijving}
                        </p>
                      ) : (
                        <p className="mt-1 text-sm text-muted/70">
                          Geen omschrijving
                        </p>
                      )}
                    </div>

                    {/* Vaste actie-kolommen zodat elke rij strak uitlijnt */}
                    <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 xl:w-auto xl:grid-cols-[6.5rem_6.25rem_6.5rem_4.75rem_4.75rem_2.25rem] xl:justify-items-stretch">
                      <Button
                        type="button"
                        size="sm"
                        className="h-9 w-full justify-center px-2"
                        variant={isOpen ? "outline" : "default"}
                        disabled={busy}
                        onClick={() => void toggleStatus(v)}
                      >
                        {isOpen ? "Zet dicht" : "Zet open"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="h-9 w-full justify-center px-2"
                        disabled={busy}
                        onClick={() => openFormEditor(v)}
                      >
                        <ListChecks className="size-4 shrink-0" />
                        Vragen
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-9 w-full justify-center px-2"
                        disabled={busy}
                        onClick={() => openEdit(v)}
                      >
                        <Pencil className="size-4 shrink-0" />
                        Bewerken
                      </Button>
                      <a
                        href={`/werkenbij/${v.id}/check`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-9 w-full items-center justify-center gap-1 rounded-md border border-line px-2 text-sm font-medium text-ink hover:bg-wash"
                      >
                        Check
                        <ExternalLink className="size-3.5 shrink-0" />
                      </a>
                      <a
                        href={`/werkenbij/${v.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-9 w-full items-center justify-center gap-1 rounded-md border border-line px-2 text-sm font-medium text-muted hover:bg-wash hover:text-ink"
                        title="Vacaturepagina"
                      >
                        Pagina
                        <ExternalLink className="size-3.5 shrink-0" />
                      </a>
                      <div className="flex h-9 w-full items-center justify-center xl:w-9">
                        {!standaard ? (
                          <button
                            type="button"
                            disabled={busy}
                            title="Verwijderen"
                            onClick={() => void remove(v)}
                            className="inline-flex size-9 items-center justify-center rounded-md text-muted hover:bg-[#FCEAEA] hover:text-[#9B2C2C] disabled:opacity-50"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        ) : (
                          <span className="size-9" aria-hidden />
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>
              {editId ? "Vacature bewerken" : "Nieuwe vacature"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="grid gap-2">
              <Label htmlFor="vac-titel" className="text-sm">
                Titel
              </Label>
              <Input
                id="vac-titel"
                value={form.titel}
                disabled={editIsStandard}
                onChange={(e) =>
                  setForm((f) => ({ ...f, titel: e.target.value }))
                }
                className="h-12 px-3 text-base md:text-base"
              />
              {editIsStandard ? (
                <p className="text-xs text-muted">
                  Standaardvacature — titel blijft vast; status kun je open/dicht
                  zetten.
                </p>
              ) : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="vac-rol" className="text-sm">
                Rol
              </Label>
              <NativeSelect
                id="vac-rol"
                value={form.rol}
                disabled={editIsStandard}
                onChange={(e) =>
                  setForm((f) => ({ ...f, rol: e.target.value }))
                }
                className="h-12 w-full text-base"
              >
                {RECRUITMENT_ROL_OPTIONS.map((r) => (
                  <NativeSelectOption key={r} value={r}>
                    {RECRUITMENT_ROL_LABEL[r]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="vac-status" className="text-sm">
                Status
              </Label>
              <NativeSelect
                id="vac-status"
                value={form.status}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    status: e.target.value as RecruitmentVacatureStatus,
                  }))
                }
                className="h-12 w-full text-base"
              >
                <NativeSelectOption value="open">Open</NativeSelectOption>
                <NativeSelectOption value="dicht">Dicht</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="vac-omschr" className="text-sm">
                Korte omschrijving
              </Label>
              <Textarea
                id="vac-omschr"
                rows={3}
                value={form.korte_omschrijving}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    korte_omschrijving: e.target.value,
                  }))
                }
                className="min-h-24 px-3 py-3 text-base md:text-base"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="vac-url" className="text-sm">
                Lander-URL (campagne / Meta)
              </Label>
              <Input
                id="vac-url"
                placeholder="https://…?campaign_id={{campaign.id}}"
                value={form.lander_url}
                onChange={(e) =>
                  setForm((f) => ({ ...f, lander_url: e.target.value }))
                }
                className="h-12 px-3 text-base md:text-base"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setFormOpen(false)}
            >
              Annuleren
            </Button>
            <Button
              type="button"
              disabled={!!busyId}
              onClick={() => void saveForm()}
            >
              Opslaan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet
        open={formEditVac != null}
        onOpenChange={(open) => {
          if (!open) setFormEditVac(null);
        }}
      >
        <SheetContent
          side="right"
          className="flex h-full w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        >
          <SheetHeader className="shrink-0 border-b px-4 py-4 pr-12 text-left">
            <SheetTitle>Sollicitatievragen</SheetTitle>
            <SheetDescription>
              {formEditVac
                ? `Voor “${formEditVac.titel}” — voeg vragen toe (keuze, open of meerkeuze) en klik opslaan.`
                : "Vragen bewerken"}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <RecruitmentFormBuilder
              value={formDraft}
              onChange={setFormDraft}
              rol={formEditVac?.rol}
            />
          </div>
          <SheetFooter className="shrink-0 border-t px-4 py-3 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => setFormEditVac(null)}
            >
              Annuleren
            </Button>
            <Button
              type="button"
              className="flex-1"
              disabled={formSaving}
              onClick={() => void saveFormBuilder()}
            >
              {formSaving ? "Opslaan…" : "Vragen opslaan"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

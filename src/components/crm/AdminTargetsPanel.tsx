"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  EDITABLE_FIELDS_BY_ROLE,
  FIELDS_BY_ROLE,
  ROLE_LABELS,
  TARGET_FIELD_META,
  computeTeamDashboardTargets,
  deriveFunnelFromInputs,
  resolvePartnerTargets,
  resolvePersonTargets,
  rolToTargetRole,
  salesPeopleForTeam,
  type AdminTargetsStore,
  type PersonOverride,
  type TargetFieldKey,
  type TargetFields,
  type TargetRole,
} from "@/lib/admin-targets";

type Medewerker = {
  id: string;
  naam: string;
  email: string | null;
  rol: string;
  actief: boolean;
};

type Partner = {
  id: string;
  naam: string;
  email: string | null;
  actief: boolean;
};

type Section = "defaults" | "personen" | "partners";

function FieldInput({
  fieldKey,
  value,
  onChange,
  placeholder,
  readOnly,
  hintOverride,
}: {
  fieldKey: TargetFieldKey;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  hintOverride?: string;
}) {
  const meta = TARGET_FIELD_META.find((f) => f.key === fieldKey)!;
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
        {meta.label}
        {meta.kind !== "percent" ? " / 7d" : ""}
      </span>
      <div className="relative mt-1">
        {meta.kind === "currency" ? (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">
            €
          </span>
        ) : null}
        <input
          type="text"
          inputMode="decimal"
          value={value}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? "0"}
          className={[
            "w-full rounded-xl border border-line py-2 text-sm text-ink outline-none",
            readOnly
              ? "cursor-default bg-wash text-ink"
              : "bg-white focus:border-green",
            meta.kind === "currency" ? "pl-7 pr-3" : "px-3",
            meta.kind === "percent" ? "pr-8" : "",
          ].join(" ")}
        />
        {meta.kind === "percent" ? (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">
            %
          </span>
        ) : null}
      </div>
      <span className="mt-0.5 block text-[10px] text-muted">
        {hintOverride || meta.hint}
      </span>
    </label>
  );
}

function fieldsToDraft(
  fields: TargetFields,
  keys: TargetFieldKey[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = String(fields[k] ?? "");
  return out;
}

function draftToPartial(
  draft: Record<string, string>,
  keys: TargetFieldKey[]
): Partial<TargetFields> {
  const out: Partial<TargetFields> = {};
  for (const k of keys) {
    const raw = draft[k];
    if (raw === undefined || raw === "") continue;
    const n = Number(String(raw).replace(",", "."));
    if (Number.isFinite(n) && n >= 0) out[k] = n;
  }
  return out;
}

export function AdminTargetsPanel() {
  const [store, setStore] = useState<AdminTargetsStore | null>(null);
  const [adviseurs, setAdviseurs] = useState<Medewerker[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("defaults");
  const [defaultRole, setDefaultRole] = useState<TargetRole>("team");
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(
    null
  );
  const [draft, setDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin-targets");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Laden mislukt");
      setStore(json.store as AdminTargetsStore);
      setAdviseurs((json.adviseurs as Medewerker[]) || []);
      setPartners((json.partners as Partner[]) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const personen = useMemo(() => {
    return adviseurs
      .filter((a) => a.actief)
      .sort((a, b) => {
        const ra = rolToTargetRole(a.rol);
        const rb = rolToTargetRole(b.rol);
        if (ra !== rb) return ra.localeCompare(rb);
        return a.naam.localeCompare(b.naam, "nl");
      });
  }, [adviseurs]);

  const selectedPerson = personen.find((p) => p.id === selectedPersonId) || null;
  const selectedPartner =
    partners.find((p) => p.id === selectedPartnerId) || null;

  // Sync draft when selection/section changes
  useEffect(() => {
    if (!store) return;
    if (section === "defaults") {
      if (defaultRole === "team") {
        const team = computeTeamDashboardTargets(store, adviseurs);
        setDraft(fieldsToDraft(team, FIELDS_BY_ROLE.team));
      } else {
        setDraft(
          fieldsToDraft(store.defaults[defaultRole], FIELDS_BY_ROLE[defaultRole])
        );
      }
      return;
    }
    if (section === "personen" && selectedPerson) {
      const rol = rolToTargetRole(selectedPerson.rol);
      const { effective } = resolvePersonTargets(store, rol, selectedPerson.id);
      setDraft(fieldsToDraft(effective, FIELDS_BY_ROLE[rol]));
      return;
    }
    if (section === "partners" && selectedPartner) {
      const { effective } = resolvePartnerTargets(store, selectedPartner.id);
      setDraft(
        fieldsToDraft(effective, FIELDS_BY_ROLE.installateur)
      );
    }
  }, [store, section, defaultRole, selectedPersonId, selectedPartnerId, selectedPerson, selectedPartner, adviseurs]);

  const salesCount = useMemo(
    () => salesPeopleForTeam(adviseurs).length,
    [adviseurs]
  );
  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch("/api/admin-targets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Opslaan mislukt");
      setStore(json.store as AdminTargetsStore);
      setOk("Opgeslagen — KPI’s worden automatisch bijgesteld.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  }

  const activeKeys: TargetFieldKey[] =
    section === "defaults"
      ? FIELDS_BY_ROLE[defaultRole]
      : section === "personen" && selectedPerson
        ? FIELDS_BY_ROLE[rolToTargetRole(selectedPerson.rol)]
        : section === "partners"
          ? FIELDS_BY_ROLE.installateur
          : [];

  const editableKeys: TargetFieldKey[] =
    section === "defaults"
      ? EDITABLE_FIELDS_BY_ROLE[defaultRole]
      : section === "personen" && selectedPerson
        ? EDITABLE_FIELDS_BY_ROLE[rolToTargetRole(selectedPerson.rol)]
        : section === "partners"
          ? EDITABLE_FIELDS_BY_ROLE.installateur
          : [];

  function setDraftField(key: TargetFieldKey, value: string) {
    setDraft((prev) => {
      const next = { ...prev, [key]: value };
      // Live afleiden leads + closing + omzet bij adviseur/beller
      if (
        key === "afsprakenGepland" ||
        key === "leadToAppt" ||
        key === "orders" ||
        key === "gemOrderwaarde"
      ) {
        const derived = deriveFunnelFromInputs({
          afsprakenGepland:
            Number(String(next.afsprakenGepland || "0").replace(",", ".")) || 0,
          leadToAppt:
            Number(String(next.leadToAppt || "0").replace(",", ".")) || 0,
          orders: Number(String(next.orders || "0").replace(",", ".")) || 0,
          gemOrderwaarde:
            Number(String(next.gemOrderwaarde || "0").replace(",", ".")) || 0,
        });
        next.leads = String(derived.leads);
        next.afspraakToSale = String(derived.afspraakToSale);
        next.omzet = String(derived.omzet);
      }
      return next;
    });
  }

  async function saveDefaults() {
    if (defaultRole === "team") return;
    const keys = EDITABLE_FIELDS_BY_ROLE[defaultRole];
    const partial = draftToPartial(draft, keys);
    // Bewaar ook afgeleide funnel-waarden voor consistentie
    if (defaultRole === "adviseur" || defaultRole === "beller") {
      const derived = deriveFunnelFromInputs({
        afsprakenGepland: partial.afsprakenGepland ?? 0,
        leadToAppt: partial.leadToAppt ?? 0,
        orders: partial.orders ?? 0,
        gemOrderwaarde: partial.gemOrderwaarde ?? 0,
      });
      partial.leads = derived.leads;
      partial.afspraakToSale = derived.afspraakToSale;
      partial.omzet = derived.omzet;
    }
    await patch({ defaults: { [defaultRole]: partial } });
  }

  async function savePerson() {
    if (!selectedPerson || !store) return;
    const rol = rolToTargetRole(selectedPerson.rol);
    const keys = EDITABLE_FIELDS_BY_ROLE[rol];
    const base = store.defaults[rol];
    const partial = draftToPartial(draft, keys);
    const override: PersonOverride = {};
    for (const k of keys) {
      if (partial[k] === undefined) continue;
      if (partial[k] !== base[k]) override[k] = partial[k];
    }
    if (Object.keys(override).length === 0) {
      await patch({ personId: selectedPerson.id, clearPerson: true });
    } else {
      await patch({
        personId: selectedPerson.id,
        personOverride: override,
      });
    }
  }

  async function resetPerson() {
    if (!selectedPerson) return;
    await patch({ personId: selectedPerson.id, clearPerson: true });
  }

  async function savePartner() {
    if (!selectedPartner || !store) return;
    const keys = EDITABLE_FIELDS_BY_ROLE.installateur;
    const base = store.defaults.installateur;
    const partial = draftToPartial(draft, keys);
    const override: PersonOverride = {};
    for (const k of keys) {
      if (partial[k] === undefined) continue;
      if (partial[k] !== base[k]) override[k] = partial[k];
    }
    if (Object.keys(override).length === 0) {
      await patch({ partnerId: selectedPartner.id, clearPartner: true });
    } else {
      await patch({
        partnerId: selectedPartner.id,
        partnerOverride: override,
      });
    }
  }

  async function resetPartner() {
    if (!selectedPartner) return;
    await patch({ partnerId: selectedPartner.id, clearPartner: true });
  }

  const personUsesDefault =
    store && selectedPerson
      ? resolvePersonTargets(
          store,
          rolToTargetRole(selectedPerson.rol),
          selectedPerson.id
        ).usesDefault
      : true;

  const partnerUsesDefault =
    store && selectedPartner
      ? resolvePartnerTargets(store, selectedPartner.id).usesDefault
      : true;

  if (loading && !store) {
    return <p className="px-4 py-6 text-sm text-muted sm:px-6">Laden…</p>;
  }

  return (
    <div className="px-4 py-5 sm:px-6">
      <div className="mb-4 flex flex-wrap gap-1 border border-line bg-white p-0.5">
        {(
          [
            ["defaults", "Standaard instellingen"],
            ["personen", "Medewerkers"],
            ["partners", "Installatiepartners"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            className={[
              "px-3 py-1.5 text-xs font-semibold transition",
              section === id
                ? "bg-green text-white"
                : "bg-white text-muted hover:bg-wash",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      <p className="mb-4 text-sm text-muted">
        Targets zijn per <span className="font-semibold text-ink">persoon / 7 dagen</span>.
        Team (dashboard) = som van alle actieve adviseurs. Dashboard v2 rekent
        dat om naar de gekozen periode. Percentages (L2A e.d.) blijven één
        team-doel en worden niet vermenigvuldigd.
      </p>

      {error ? (
        <p className="mb-3 rounded-xl border border-[#C62828]/30 bg-[#FFEBEE] px-3 py-2 text-sm text-[#C62828]">
          {error}
        </p>
      ) : null}
      {ok ? (
        <p className="mb-3 rounded-xl border border-green/30 bg-green-soft/40 px-3 py-2 text-sm text-green-deeper">
          {ok}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        {/* Sidebar */}
        <aside className="rounded-2xl border border-line bg-white p-3">
          {section === "defaults" ? (
            <ul className="space-y-1">
              {(Object.keys(ROLE_LABELS) as TargetRole[]).map((r) => (
                <li key={r}>
                  <button
                    type="button"
                    onClick={() => setDefaultRole(r)}
                    className={[
                      "w-full rounded-xl px-3 py-2 text-left text-sm font-medium",
                      defaultRole === r
                        ? "bg-green text-white"
                        : "text-ink hover:bg-wash",
                    ].join(" ")}
                  >
                    {ROLE_LABELS[r]}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {section === "personen" ? (
            <ul className="max-h-[28rem] space-y-1 overflow-y-auto">
              {personen.length === 0 ? (
                <li className="px-2 py-3 text-sm text-muted">
                  Geen actieve medewerkers. Voeg ze toe via Instellingen.
                </li>
              ) : (
                personen.map((p) => {
                  const rol = rolToTargetRole(p.rol);
                  const custom =
                    store &&
                    !resolvePersonTargets(store, rol, p.id).usesDefault;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedPersonId(p.id)}
                        className={[
                          "w-full rounded-xl px-3 py-2 text-left",
                          selectedPersonId === p.id
                            ? "bg-green text-white"
                            : "hover:bg-wash",
                        ].join(" ")}
                      >
                        <p className="text-sm font-medium">{p.naam}</p>
                        <p
                          className={[
                            "text-[11px]",
                            selectedPersonId === p.id
                              ? "text-white/80"
                              : "text-muted",
                          ].join(" ")}
                        >
                          {ROLE_LABELS[rol]}
                          {custom ? " · eigen target" : " · standaard"}
                        </p>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          ) : null}

          {section === "partners" ? (
            <ul className="max-h-[28rem] space-y-1 overflow-y-auto">
              {partners.filter((p) => p.actief).length === 0 ? (
                <li className="px-2 py-3 text-sm text-muted">
                  Geen actieve partners. Voeg ze toe via Instellingen.
                </li>
              ) : (
                partners
                  .filter((p) => p.actief)
                  .map((p) => {
                    const custom =
                      store &&
                      !resolvePartnerTargets(store, p.id).usesDefault;
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedPartnerId(p.id)}
                          className={[
                            "w-full rounded-xl px-3 py-2 text-left",
                            selectedPartnerId === p.id
                              ? "bg-green text-white"
                              : "hover:bg-wash",
                          ].join(" ")}
                        >
                          <p className="text-sm font-medium">{p.naam}</p>
                          <p
                            className={[
                              "text-[11px]",
                              selectedPartnerId === p.id
                                ? "text-white/80"
                                : "text-muted",
                            ].join(" ")}
                          >
                            {custom ? "Eigen target" : "Standaard"}
                          </p>
                        </button>
                      </li>
                    );
                  })
              )}
            </ul>
          ) : null}
        </aside>

        {/* Editor */}
        <section className="rounded-2xl border border-line bg-white p-5">
          {section === "defaults" ? (
            <>
              <h3 className="font-display text-lg font-semibold text-ink">
                Standaard · {ROLE_LABELS[defaultRole]}
              </h3>
              <p className="mt-1 text-sm text-muted">
                {defaultRole === "team"
                  ? `Automatisch berekend voor Dashboard v2: ${salesCount} actieve adviseur${salesCount === 1 ? "" : "s"} × hun targets (volume). Percentages komen uit de Adviseurs-standaard.`
                  : defaultRole === "adviseur"
                    ? "Vul afspraken (bijv. 4/dag × 5 dagen), L2A% en orders in. Leads en closing % worden automatisch berekend. Team = som × actieve adviseurs."
                    : defaultRole === "beller"
                      ? "Vul afspraken + L2A% in; leads nodig wordt berekend."
                      : "Geldt automatisch voor iedereen met deze rol zonder eigen override."}
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {activeKeys.map((k) => {
                  const isComputed =
                    defaultRole !== "team" && !editableKeys.includes(k);
                  return (
                    <FieldInput
                      key={k}
                      fieldKey={k}
                      value={draft[k] ?? ""}
                      readOnly={defaultRole === "team" || isComputed}
                      hintOverride={
                        defaultRole === "team" &&
                        (k === "leads" ||
                          k === "afsprakenGepland" ||
                          k === "orders" ||
                          k === "omzet")
                          ? `Team-totaal / 7d (${salesCount}× adviseur)`
                          : defaultRole === "team" && k === "gemOrderwaarde"
                            ? "Uit Adviseurs-standaard (niet × headcount)"
                            : defaultRole === "team"
                            ? "Uit Adviseurs-standaard (niet × headcount)"
                            : isComputed
                              ? TARGET_FIELD_META.find((m) => m.key === k)?.hint
                              : undefined
                      }
                      onChange={(v) => setDraftField(k, v)}
                    />
                  );
                })}
              </div>
              {defaultRole === "team" ? (
                <p className="mt-5 text-sm text-muted">
                  Pas targets aan via <span className="font-semibold text-ink">Adviseurs</span>{" "}
                  (standaard of per medewerker). Dashboard v2 gebruikt dit team-totaal
                  direct.
                </p>
              ) : (
                <div className="mt-5 flex justify-end">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void saveDefaults()}
                    className="rounded-xl bg-green px-4 py-2 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-50"
                  >
                    {saving ? "Opslaan…" : "Standaard opslaan"}
                  </button>
                </div>
              )}
            </>
          ) : null}

          {section === "personen" ? (
            !selectedPerson ? (
              <p className="text-sm text-muted">
                Kies een medewerker links. Bellers, adviseurs en installateurs
                staan hier zodra ze actief zijn in Instellingen.
              </p>
            ) : (
              <>
                <h3 className="font-display text-lg font-semibold text-ink">
                  {selectedPerson.naam}
                </h3>
                <p className="mt-1 text-sm text-muted">
                  Rol: {ROLE_LABELS[rolToTargetRole(selectedPerson.rol)]}
                  {personUsesDefault
                    ? " · gebruikt standaard"
                    : " · eigen targets"}
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {activeKeys.map((k) => {
                    const rol = rolToTargetRole(selectedPerson.rol);
                    const isComputed = !EDITABLE_FIELDS_BY_ROLE[rol].includes(k);
                    return (
                      <FieldInput
                        key={k}
                        fieldKey={k}
                        value={draft[k] ?? ""}
                        readOnly={isComputed}
                        onChange={(v) => setDraftField(k, v)}
                        placeholder={
                          store
                            ? String(store.defaults[rol][k])
                            : undefined
                        }
                      />
                    );
                  })}
                </div>
                <div className="mt-5 flex flex-wrap justify-end gap-2">
                  {!personUsesDefault ? (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void resetPerson()}
                      className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-wash disabled:opacity-50"
                    >
                      Terug naar standaard
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void savePerson()}
                    className="rounded-xl bg-green px-4 py-2 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-50"
                  >
                    {saving ? "Opslaan…" : "Targets opslaan"}
                  </button>
                </div>
              </>
            )
          ) : null}

          {section === "partners" ? (
            !selectedPartner ? (
              <p className="text-sm text-muted">
                Kies een installatiepartner links.
              </p>
            ) : (
              <>
                <h3 className="font-display text-lg font-semibold text-ink">
                  {selectedPartner.naam}
                </h3>
                <p className="mt-1 text-sm text-muted">
                  {partnerUsesDefault
                    ? "Gebruikt standaard installatie-targets"
                    : "Eigen targets"}
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {activeKeys.map((k) => (
                    <FieldInput
                      key={k}
                      fieldKey={k}
                      value={draft[k] ?? ""}
                      onChange={(v) =>
                        setDraft((prev) => ({ ...prev, [k]: v }))
                      }
                    />
                  ))}
                </div>
                <div className="mt-5 flex flex-wrap justify-end gap-2">
                  {!partnerUsesDefault ? (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void resetPartner()}
                      className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-wash disabled:opacity-50"
                    >
                      Terug naar standaard
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void savePartner()}
                    className="rounded-xl bg-green px-4 py-2 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-50"
                  >
                    {saving ? "Opslaan…" : "Targets opslaan"}
                  </button>
                </div>
              </>
            )
          ) : null}
        </section>
      </div>
    </div>
  );
}

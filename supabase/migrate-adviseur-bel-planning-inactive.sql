-- Inactief of geblokkeerd: standaard uit het bel-systeem.
-- `bel_planning` blijft daarna los te zetten in Instellingen → Actief in planning.
update public.adviseurs
set bel_planning = false
where bel_planning is distinct from false
  and (
    actief = false
    or coalesce(geblokkeerd, false) = true
  );

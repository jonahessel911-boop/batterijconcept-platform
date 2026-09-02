-- Projecten horen pas in de backoffice ná afronden van de offerte-actie.
-- Ruimt prematuur aangemaakte projecten op (offerte nog actie_required).

-- Ontkoppel concept-facturen zodat delete niet hapert
update public.facturen f
set project_id = null
from public.projecten p
join public.offertes o on o.id = p.offerte_id
where f.project_id = p.id
  and o.actie_required = true
  and p.status = 'schouw_inplannen';

-- Foto's / service verzoeken cascaden mee
delete from public.projecten p
using public.offertes o
where p.offerte_id = o.id
  and o.actie_required = true
  and p.status = 'schouw_inplannen'
  and p.schouw_at is null
  and coalesce(p.schouw_week, 0) = 0;

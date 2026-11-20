/**
 * WF-adviseur-slots: alleen via Acties inplannen.
 * Startadres Bunschoten-Spakenburg; uren 09 / 11 / 13 / 15 / 17 / 19.
 */

import { EDERGY_THUIS_ADRES } from "@/lib/edergy-tarief";
import { WF_ADVISEUR_SLOT_HOURS } from "@/lib/slots";

export { WF_ADVISEUR_SLOT_HOURS };

export const WF_ADVISEUR_START_ADRES = EDERGY_THUIS_ADRES;
export const WF_ADVISEUR_START_LABEL = "Bunschoten-Spakenburg";

export function isWfAdviseurSlotHour(hour: number): boolean {
  return (WF_ADVISEUR_SLOT_HOURS as readonly number[]).includes(hour);
}

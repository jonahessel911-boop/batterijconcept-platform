import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn-stijl: klassen samenvoegen zonder dat Tailwind elkaar overschrijft. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

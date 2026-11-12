import Image from "next/image";
import { ArrowDown } from "lucide-react";
import { WerkenbijShell } from "@/components/werkenbij/WerkenbijShell";
import { WerkenbijVacaturesList } from "@/components/werkenbij/WerkenbijVacaturesList";

export const metadata = {
  title: "Werken bij BatterijConcept",
  description:
    "Echte knallers gezocht. Help mee om de grootste B2C-verduurzamingspartij van Nederland te worden.",
};

export default function WerkenbijPage() {
  return (
    <WerkenbijShell flush>
      <section className="relative w-full overflow-hidden">
        <div className="relative min-h-[min(88vh,48rem)] w-full">
          <Image
            src="/werkenbij/hero.jpg"
            alt="Thuisbatterij en warmtepomp bij een Nederlandse woning"
            fill
            priority
            sizes="100vw"
            className="object-cover object-[72%_center]"
          />
          <div
            aria-hidden
            className="absolute inset-0 bg-[linear-gradient(105deg,rgba(10,71,39,0.9)_0%,rgba(10,71,39,0.75)_36%,rgba(10,71,39,0.35)_64%,rgba(10,71,39,0.15)_100%)]"
          />
          <div className="relative mx-auto flex min-h-[min(88vh,48rem)] max-w-6xl flex-col justify-end px-4 pb-14 pt-24 sm:px-6 sm:pb-20">
            <div className="max-w-xl motion-safe:animate-[werkenbij-rise_0.7s_ease-out_both]">
              <p className="font-display text-4xl font-bold leading-[0.95] tracking-tight text-white sm:text-6xl lg:text-7xl">
                BatterijConcept
              </p>
              <h1 className="mt-5 max-w-lg text-xl font-semibold leading-snug tracking-tight text-white/95 sm:text-2xl">
                Echte knallers gezocht voor thuisbatterijen en warmtepompen.
              </h1>
              <p className="mt-4 max-w-md text-base leading-relaxed text-white/80 sm:text-lg">
                Help mee om de grootste B2C-verduurzamingspartij van Nederland
                te worden.
              </p>
              <a
                href="#vacatures"
                className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-green-deeper transition hover:bg-green-soft"
              >
                Bekijk open rollen
                <ArrowDown className="size-4" />
              </a>
            </div>
          </div>
        </div>
      </section>

      <section
        id="vacatures"
        className="scroll-mt-8 mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16"
      >
        <div className="mb-8 max-w-2xl">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            Open vacatures
          </h2>
          <p className="mt-2 text-base text-muted">
            Kies je rol. Lees de vacature. Doe daarna de snelle check.
          </p>
        </div>
        <WerkenbijVacaturesList />
      </section>
    </WerkenbijShell>
  );
}

import { Eyebrow } from "@/components/ui";
import { MapSlot } from "@/components/mission/map-slot";

/** Discovery (Swarm add-on): the market map of segments the swarm proposed and Sounding tested. */
export default function MarketPage() {
  return (
    <main className="flex h-full min-h-[600px] flex-col gap-4 p-4 md:px-6 md:py-5">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <div>
          <Eyebrow>Discovery</Eyebrow>
          <h1 className="mt-1 text-[28px] leading-tight font-bold tracking-[-0.02em] text-strong md:text-[32px]">Markets you didn&apos;t know you had</h1>
        </div>
        <p className="hidden max-w-[380px] pb-1 text-[13px] leading-snug text-muted min-[1400px]:block">
          Swarm guesses who wants this. Sounding checks the public record. Top right is where both agree.
        </p>
      </header>
      <div className="min-h-[480px] flex-1">
        <MapSlot />
      </div>
    </main>
  );
}

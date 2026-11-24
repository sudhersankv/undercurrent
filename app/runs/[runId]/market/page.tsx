import { Eyebrow } from "@/components/ui";
import { MapSlot } from "@/components/mission/map-slot";

/** Discovery (Swarm add-on): the market map of segments the swarm proposed and Sounding tested. */
export default function MarketPage() {
  return (
    <main className="flex h-full min-h-[560px] flex-col gap-3 p-4 md:p-6">
      <header>
        <Eyebrow>Discovery</Eyebrow>
        <h1 className="mt-1 text-[22px]">Markets you&apos;re not selling to yet</h1>
      </header>
      <div className="min-h-[480px] flex-1">
        <MapSlot />
      </div>
    </main>
  );
}

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Eyebrow } from "@/components/ui";
import { MarketMap } from "@/components/market-map";

export default async function MarketPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return (
    <main className="flex h-dvh flex-col gap-4 p-6">
      <header className="flex items-end gap-4">
        <div>
          <Link href={`/runs/${runId}`} className="mb-2 inline-flex items-center gap-1 text-xs text-muted hover:text-strong">
            <ArrowLeft className="size-3.5" />
            Mission control
          </Link>
          <Eyebrow>Market map</Eyebrow>
          <h1 className="mt-1 text-2xl">Where the world agrees</h1>
        </div>
        <p className="ml-auto font-mono text-[11px] text-muted">{runId}</p>
      </header>
      <MarketMap runId={runId} className="flex-1" />
    </main>
  );
}

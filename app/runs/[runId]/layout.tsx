import { LoopStrip } from "@/components/mission/loop-strip";
import { MissionHeader } from "@/components/mission/mission-header";
import { RunProvider } from "@/components/mission/run-context";
import { TelemetryFooter } from "@/components/mission/telemetry-footer";

/** Shell for every run view: one SSE subscription (RunProvider), header + loop strip on top, telemetry below. */
export default async function RunLayout({ children, params }: { children: React.ReactNode; params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return (
    <RunProvider runId={runId}>
      <div className="flex h-dvh flex-col overflow-hidden">
        <MissionHeader />
        <LoopStrip />
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        <TelemetryFooter />
      </div>
    </RunProvider>
  );
}

import { ChatBox } from "@/components/mission/chat-box";
import { HandoffFeed } from "@/components/mission/handoff-feed";
import { LoopStrip } from "@/components/mission/loop-strip";
import { MissionHeader } from "@/components/mission/mission-header";
import { RunProvider } from "@/components/mission/run-context";
import { TelemetryFooter } from "@/components/mission/telemetry-footer";

/**
 * Shell for every run view: one SSE subscription (RunProvider), header + department loop strip on top,
 * handoff feed + Helm chat on the right (the six departments working as a team, SPEC §1.5), telemetry below.
 */
export default async function RunLayout({ children, params }: { children: React.ReactNode; params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return (
    <RunProvider runId={runId}>
      <div className="flex h-dvh flex-col overflow-hidden">
        <MissionHeader />
        <LoopStrip />
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</div>
          <aside aria-label="Team" className="flex h-[420px] shrink-0 flex-col overflow-hidden border-t border-hairline bg-canvas lg:h-auto lg:w-[340px] lg:border-l lg:border-t-0 xl:w-[380px]">
            <HandoffFeed />
            <ChatBox />
          </aside>
        </div>
        <TelemetryFooter />
      </div>
    </RunProvider>
  );
}

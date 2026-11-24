import { ChatBox } from "@/components/mission/chat-box";
import { HandoffFeed } from "@/components/mission/handoff-feed";
import { MissionHeader } from "@/components/mission/mission-header";
import { RunProvider } from "@/components/mission/run-context";
import { TelemetryFooter } from "@/components/mission/telemetry-footer";

/**
 * Shell for every run view: one SSE subscription (RunProvider), a compact header (run switcher, status,
 * segmented nav, department stepper), the team activity timeline + Helm chat on the right (SPEC §1.5), telemetry below.
 */
export default async function RunLayout({ children, params }: { children: React.ReactNode; params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return (
    // keyed so switching runs (demo run switcher) starts every panel fresh
    <RunProvider key={runId} runId={runId}>
      <div className="flex h-dvh flex-col overflow-hidden bg-canvas text-body">
        <MissionHeader />
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="min-h-0 min-w-0 flex-1 overflow-auto bg-canvas">{children}</div>
          <aside aria-label="Team" className="flex h-[420px] shrink-0 flex-col overflow-hidden border-t border-hairline bg-paper lg:h-auto lg:w-[360px] lg:border-l lg:border-t-0 xl:w-[400px]">
            <HandoffFeed />
            <ChatBox />
          </aside>
        </div>
        <TelemetryFooter />
      </div>
    </RunProvider>
  );
}

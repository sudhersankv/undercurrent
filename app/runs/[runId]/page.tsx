import { ChatBox } from "@/components/mission/chat-box";
import { HandoffFeed } from "@/components/mission/handoff-feed";
import { MapSlot } from "@/components/mission/map-slot";

/** Mission control (SPEC §10.3): market map left (~60%), handoff feed + Helm chat right. */
export default function MissionPage() {
  return (
    <div className="grid h-full grid-cols-1 gap-3 p-3 lg:grid-cols-[minmax(0,3fr)_minmax(360px,2fr)]">
      <div className="min-h-[360px] lg:min-h-0">
        <MapSlot />
      </div>
      <div className="flex min-h-[560px] flex-col overflow-hidden rounded-card border border-hairline bg-canvas lg:min-h-0">
        <HandoffFeed />
        <ChatBox />
      </div>
    </div>
  );
}

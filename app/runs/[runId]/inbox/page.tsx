import { InboxView } from "@/components/inbox/inbox-view";
import { WakeSlot } from "@/components/mission/map-slot";

export default async function InboxPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return (
    <>
      <InboxView runId={runId} />
      <div className="px-4 pb-6 md:px-6">
        <WakeSlot />
      </div>
    </>
  );
}

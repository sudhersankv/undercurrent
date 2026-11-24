import { InboxView } from "@/components/inbox/inbox-view";

export default async function InboxPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return <InboxView runId={runId} />;
}

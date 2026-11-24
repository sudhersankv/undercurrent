import { LeadsView } from "@/components/leads";

export default async function LeadsPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return <LeadsView runId={runId} />;
}

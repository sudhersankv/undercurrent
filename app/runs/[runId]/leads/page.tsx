import { LeadsView } from "@/components/leads";

export default async function LeadsPage({ params, searchParams }: { params: Promise<{ runId: string }>; searchParams: Promise<{ view?: string }> }) {
  const { runId } = await params;
  const { view } = await searchParams;
  return <LeadsView runId={runId} initialView={view === "accounts" ? "accounts" : "people"} />;
}

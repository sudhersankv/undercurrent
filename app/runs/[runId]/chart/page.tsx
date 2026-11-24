import { ChartView } from "@/components/chart";

export default async function ChartPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return <ChartView runId={runId} />;
}

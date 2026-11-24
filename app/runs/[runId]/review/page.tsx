import { ReviewScreen } from "@/components/review";

export default async function ReviewPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return (
    <main className="mx-auto flex max-w-[1440px] flex-col gap-6 p-4 md:p-6">
      <ReviewScreen runId={runId} />
    </main>
  );
}

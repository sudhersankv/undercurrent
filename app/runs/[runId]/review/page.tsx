import { Eyebrow } from "@/components/ui";
import { ReviewScreen } from "@/components/review";

export default async function ReviewPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return (
    <main className="mx-auto flex max-w-[1440px] flex-col gap-6 p-4 md:p-6">
      <header>
        <Eyebrow>Outreach</Eyebrow>
        <h1 className="mt-1.5 text-[28px] font-bold tracking-[-0.02em] text-strong md:text-[32px]">Nothing sends without you</h1>
      </header>
      <ReviewScreen runId={runId} />
    </main>
  );
}

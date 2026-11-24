import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Eyebrow } from "@/components/ui";
import { ReviewScreen } from "@/components/review";

export default async function ReviewPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return (
    <main className="mx-auto flex max-w-[1440px] flex-col gap-5 p-6">
      <header className="flex items-end gap-4">
        <div>
          <Link href={`/runs/${runId}`} className="mb-2 inline-flex items-center gap-1 text-xs text-muted hover:text-strong">
            <ArrowLeft className="size-3.5" />
            Mission control
          </Link>
          <Eyebrow>Review</Eyebrow>
          <h1 className="mt-1 text-2xl">Nothing sends without you</h1>
        </div>
        <p className="ml-auto font-mono text-[11px] text-muted">{runId}</p>
      </header>
      <ReviewScreen runId={runId} />
    </main>
  );
}

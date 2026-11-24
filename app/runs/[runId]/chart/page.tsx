import { Eyebrow } from "@/components/ui";

// Placeholder: owned by its UI ticket (see CONTRIBUTING.md).
export default async function Page({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return (
    <main className="p-8">
      <Eyebrow>chart</Eyebrow>
      <p className="font-mono text-[13px]">{runId}</p>
    </main>
  );
}

import Link from "next/link";

// Placeholder. Ticket #12 owns the landing page.
export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-6 px-6">
      <p className="eyebrow">Undercurrent</p>
      <h1 className="text-5xl">Find the markets you didn&apos;t know you had.</h1>
      <div className="flex gap-4 text-sm">
        <Link className="text-lichen underline-offset-4 hover:underline" href="/dev/tokens">
          Design tokens
        </Link>
      </div>
    </main>
  );
}

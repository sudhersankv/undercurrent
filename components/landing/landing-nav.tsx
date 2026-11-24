"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

/** Sticky landing nav: transparent at the top, hairline once you scroll. */
export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  const link = "hidden h-9 items-center rounded-pill px-3.5 text-[15px] font-semibold text-forest transition-colors duration-150 hover:bg-recessed sm:inline-flex";
  return (
    <header className={cn("sticky top-0 z-40 border-b bg-paper transition-colors duration-200", scrolled ? "border-hairline" : "border-transparent")}>
      <div className="mx-auto flex h-[72px] w-full max-w-[1200px] items-center justify-between gap-4 px-4 sm:px-8">
        <Link href="/" aria-label="Undercurrent home" className="transition-opacity hover:opacity-80">
          <Logo size={22} />
        </Link>
        <nav className="flex items-center gap-1">
          <a href="#how" className={link}>
            How it works
          </a>
          <Link href="/runs/showcase" className={link}>
            Showcase
          </Link>
          <Button asChild variant="cta" size="md" className="ml-2">
            <a href="#start">Start a run</a>
          </Button>
        </nav>
      </div>
    </header>
  );
}

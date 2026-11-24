import * as React from "react";
import { cn } from "@/lib/utils";

/** Uppercase tracked label (0.12em). */
export function Eyebrow({ className, as: Comp = "p", ...props }: React.HTMLAttributes<HTMLElement> & { as?: "p" | "span" | "div" | "h2" }) {
  return <Comp className={cn("eyebrow", className)} {...props} />;
}

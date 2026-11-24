import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Cards (Wise): flat, 10px radius, hairline border. `raised` = white card (use on fog/linen sections),
 * `recessed` = fog panel (use on the white canvas), `interactive` = white card with linen hover,
 * `forest` = inverted dark card (text-paper body, text-lime emphasis). `large` radius = 28px feature cards.
 */
export const cardVariants = cva("border", {
  variants: {
    surface: {
      raised: "bg-paper border-hairline",
      recessed: "bg-recessed border-transparent",
      interactive: "bg-paper border-hairline transition-colors hover:border-hairline-strong hover:bg-linen/50 cursor-pointer",
      forest: "bg-forest border-transparent text-paper",
    },
    radius: { card: "rounded-card", large: "rounded-large" },
    pad: { none: "", sm: "p-3", md: "p-4", lg: "p-6", xl: "p-10" },
  },
  defaultVariants: { surface: "raised", radius: "card", pad: "md" },
});

export interface CardProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(({ className, surface, radius, pad, ...props }, ref) => (
  <div ref={ref} className={cn(cardVariants({ surface, radius, pad }), className)} {...props} />
));
Card.displayName = "Card";

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-3 flex items-center justify-between gap-2", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-base font-semibold text-strong", className)} {...props} />;
}

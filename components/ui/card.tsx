import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/** Cards: `raised` sits above the canvas, `recessed` sinks below it. No shadows, 16px radius. */
export const cardVariants = cva("rounded-card border", {
  variants: {
    surface: {
      raised: "bg-raised border-hairline",
      recessed: "bg-recessed border-hairline",
      interactive: "bg-raised border-hairline transition-colors hover:bg-raised-hover cursor-pointer",
    },
    pad: { none: "", sm: "p-3", md: "p-4", lg: "p-6" },
  },
  defaultVariants: { surface: "raised", pad: "md" },
});

export interface CardProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(({ className, surface, pad, ...props }, ref) => (
  <div ref={ref} className={cn(cardVariants({ surface, pad }), className)} {...props} />
));
Card.displayName = "Card";

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-3 flex items-center justify-between gap-2", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-[15px] font-medium text-strong", className)} {...props} />;
}

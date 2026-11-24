import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Pill buttons (Wise). `cta` = lime fill, one per section. `forest` = dark fill (use on lime/linen bands).
 * `outline` = white + forest border (secondary). `raised` = fog fill (quiet toolbar). `ghost` = text only.
 * `link` = underlined forest text, the secondary action beside a cta. Never two filled buttons side by side.
 * Labels: 3 words or fewer.
 */
export const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-pill font-semibold tracking-[-0.006em] transition-[background-color,color,border-color,transform] duration-150 ease-out-soft active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        cta: "bg-lime text-forest hover:bg-[#8fdb5e]",
        forest: "bg-forest text-lime hover:bg-spruce",
        raised: "bg-raised text-forest hover:bg-linen",
        ghost: "text-forest hover:bg-raised",
        outline: "border border-forest bg-paper text-forest hover:bg-linen",
        link: "h-auto rounded-none px-0 text-forest underline decoration-[1.5px] underline-offset-4 hover:decoration-2 active:scale-100",
      },
      size: {
        sm: "h-8 px-3.5 text-[13px]",
        md: "h-9 px-4 text-sm",
        lg: "h-12 px-6 text-base",
        icon: "size-9",
      },
    },
    // Size padding/height would otherwise override the link look.
    compoundVariants: [{ variant: "link", className: "h-auto px-0" }],
    defaultVariants: { variant: "raised", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
Button.displayName = "Button";

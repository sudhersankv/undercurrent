import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/** Buttons: `cta` = gradient primary (one per screen), `raised` = default, `ghost` = quiet. Labels ≤3 words. */
export const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-control font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        cta: "bg-cta text-recessed hover:brightness-105 active:brightness-95",
        raised: "bg-raised text-strong hover:bg-raised-hover border border-hairline",
        ghost: "text-body hover:bg-raised hover:text-strong",
        outline: "border border-hairline-strong text-strong hover:bg-raised",
      },
      size: {
        sm: "h-7 px-2.5 text-xs",
        md: "h-8 px-3 text-[13px]",
        lg: "h-11 px-5 text-sm",
        icon: "size-8",
      },
    },
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

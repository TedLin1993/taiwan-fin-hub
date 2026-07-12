import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steel focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-ink text-white shadow-sm hover:bg-ink/90",
        primary: "bg-steel text-white shadow-sm hover:bg-steel/90",
        secondary: "border border-ink/10 bg-white text-ink shadow-sm hover:bg-ink/5",
        ghost: "text-ink/70 hover:bg-ink/5 hover:text-ink",
        destructive: "bg-coral text-white shadow-sm hover:bg-coral/90"
      },
      size: {
        sm: "h-9 px-3 [&_svg]:size-4",
        default: "h-10 px-4 [&_svg]:size-4",
        touch: "min-h-11 px-4 [&_svg]:size-5",
        icon: "size-11 p-0 [&_svg]:size-5"
      }
    },
    defaultVariants: { variant: "default", size: "default" }
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";

export { buttonVariants };

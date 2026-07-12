import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Card({
  as: Comp = "div",
  className,
  ...props
}: HTMLAttributes<HTMLElement> & { as?: "div" | "section" | "article" }) {
  return <Comp className={cn("rounded-xl border border-ink/10 bg-white text-ink shadow-sm", className)} {...props} />;
}

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("flex flex-col gap-1.5 p-5", className)} {...props} />
);
CardHeader.displayName = "CardHeader";

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("p-5 pt-0", className)} {...props} />
);
CardContent.displayName = "CardContent";

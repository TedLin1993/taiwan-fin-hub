import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";

const iconSizes = {
  sm: "size-4",
  md: "size-[18px]",
  lg: "size-5",
  nav: "size-[22px]",
  empty: "size-9"
} as const;

export function AppIcon({
  icon: Icon,
  size = "md",
  className,
  label
}: {
  icon: LucideIcon;
  size?: keyof typeof iconSizes;
  className?: string;
  label?: string;
}) {
  return (
    <Icon
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={cn("shrink-0 stroke-[1.8]", iconSizes[size], className)}
    />
  );
}

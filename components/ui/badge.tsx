import { cn } from "@/lib/utils";

const variants = {
  default: "bg-slate-100 text-foreground",
  accent: "bg-accent-soft text-accent",
  success: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  rag: "bg-indigo-50 text-indigo-700",
  noRag: "bg-orange-50 text-orange-700",
};

export function Badge({
  children,
  variant = "default",
  className,
}: {
  children: React.ReactNode;
  variant?: keyof typeof variants;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

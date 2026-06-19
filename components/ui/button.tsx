import { cn } from "@/lib/utils";

const variants = {
  primary:
    "bg-accent text-white hover:bg-blue-700 disabled:bg-blue-300",
  secondary:
    "border border-border bg-white text-foreground hover:bg-slate-50 disabled:opacity-50 dark:bg-card dark:hover:bg-slate-800",
  danger:
    "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50",
};

export function Button({
  children,
  className,
  variant = "primary",
  loading,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
  loading?: boolean;
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed",
        variants[variant],
        className,
      )}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  );
}

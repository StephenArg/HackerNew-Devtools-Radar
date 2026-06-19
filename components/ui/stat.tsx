import { cn } from "@/lib/utils";

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-slate-50 p-10 text-center">
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="mx-auto mt-2 max-w-lg text-sm text-muted">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-muted">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      {label ?? "Loading…"}
    </div>
  );
}

export function Alert({
  variant = "info",
  children,
}: {
  variant?: "info" | "error" | "success";
  children: React.ReactNode;
}) {
  const styles = {
    info: "border-blue-200 bg-blue-50 text-blue-800",
    error: "border-red-200 bg-red-50 text-red-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  };

  return (
    <div className={cn("rounded-lg border px-4 py-3 text-sm", styles[variant])}>
      {children}
    </div>
  );
}

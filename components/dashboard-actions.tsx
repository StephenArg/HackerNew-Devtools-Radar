"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, Spinner, Stat } from "@/components/ui/stat";
import type { StatsResponse } from "@/types";
import { cn, formatDate } from "@/lib/utils";

type ToastVariant = "success" | "error" | "info";
interface Toast {
  id: number;
  variant: ToastVariant;
  message: string;
}

type ActionKey =
  | "seed"
  | "clear"
  | "ingest"
  | "both"
  | "rag"
  | "noRag";

// Long-running actions that warrant a blocking full-page overlay.
const OVERLAY_ACTIONS: Partial<Record<ActionKey, string>> = {
  ingest: "Ingesting the last 7 days of Hacker News threads…",
  both: "Generating RAG and non-RAG reports and judging them…",
};

function LoadingOverlay({ message }: { message: string }) {
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-slate-900/40 backdrop-blur-sm"
    >
      <span className="h-12 w-12 animate-spin rounded-full border-4 border-white/40 border-t-white" />
      <p className="max-w-sm px-6 text-center text-sm font-medium text-white">
        {message}
      </p>
      <p className="text-xs text-white/70">This can take a moment — please wait.</p>
    </div>,
    document.body,
  );
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  const styles: Record<ToastVariant, string> = {
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    error: "border-red-200 bg-red-50 text-red-800",
    info: "border-blue-200 bg-blue-50 text-blue-800",
  };

  if (toasts.length === 0 || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-[110] flex w-full max-w-sm flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          aria-live="polite"
          className={cn(
            "pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg",
            styles[toast.variant],
          )}
        >
          <span className="flex-1">{toast.message}</span>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss notification"
            className="-mr-1 -mt-0.5 rounded p-1 opacity-60 transition hover:bg-black/5 hover:opacity-100"
          >
            <span aria-hidden className="text-base leading-none">
              ×
            </span>
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

const actions: Array<{
  key: ActionKey;
  label: string;
  endpoint: string;
  variant: "primary" | "secondary" | "danger";
  description: string;
}> = [
  {
    key: "ingest",
    label: "Ingest Last 7 Days",
    endpoint: "/api/ingest",
    variant: "primary",
    description: "Fetch recent HN threads, score for devtools relevance, keep matches above threshold.",
  },
  {
    key: "both",
    label: "Generate RAG + No-RAG Reports",
    endpoint: "/api/reports/both",
    variant: "primary",
    description:
      "One batched LLM call: no-RAG report, RAG report, and rubric judge scores.",
  },
  {
    key: "clear",
    label: "Clear Data",
    endpoint: "/api/clear",
    variant: "danger",
    description: "Remove all ingested data and reports.",
  },
];

export function DashboardActions() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [activeAction, setActiveAction] = useState<ActionKey | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback(
    (variant: ToastVariant, message: string) => {
      const id = ++toastId.current;
      setToasts((current) => [...current, { id, variant, message }]);
      setTimeout(() => dismissToast(id), 6000);
    },
    [dismissToast],
  );

  const loadStats = useCallback(async () => {
    setLoadingStats(true);
    try {
      const res = await fetch("/api/stats");
      const data = (await res.json()) as StatsResponse;
      setStats(data);
    } catch {
      addToast("error", "Could not load stats. Is the database running?");
    } finally {
      setLoadingStats(false);
    }
  }, [addToast]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const overlayMessage = activeAction ? OVERLAY_ACTIONS[activeAction] : undefined;

  // Lock page scroll while the blocking overlay is visible.
  useEffect(() => {
    if (!overlayMessage) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [overlayMessage]);

  async function runAction(action: (typeof actions)[number]) {
    setActiveAction(action.key);

    try {
      const res = await fetch(action.endpoint, { method: "POST" });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.error ?? "Action failed");
      }
      if (data.warning) {
        addToast("info", `${action.label} completed (mock data). ${data.warning}`);
      } else {
        addToast(
          "success",
          action.key === "clear"
            ? "All data cleared."
            : action.key === "ingest" && typeof data.filtered === "number"
              ? `${action.label} complete — ${data.sources} sources, ${data.chunks} chunks kept; ${data.filtered} filtered out as off-topic.`
              : `${action.label} completed successfully.`,
        );
      }
      await loadStats();
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Action failed");
    } finally {
      setActiveAction(null);
    }
  }

  return (
    <div className="space-y-8">
      {overlayMessage && <LoadingOverlay message={overlayMessage} />}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {loadingStats ? (
          <div className="col-span-full">
            <Spinner label="Loading ingestion status…" />
          </div>
        ) : stats ? (
          <>
            <Stat
              label="HN Threads / Sources"
              value={stats.sources}
              hint="Original Hacker News discussions"
            />
            <Stat
              label="Community Documents"
              value={stats.documents}
              hint="Posts & comments"
            />
            <Stat
              label="Embedded Snippets"
              value={stats.chunks}
              hint="Chunks stored in pgvector"
            />
            <Stat
              label="Reports"
              value={stats.reports}
              hint={`Latest ingestion: ${formatDate(stats.latestIngestion)}`}
            />
          </>
        ) : (
          <div className="col-span-full">
            <EmptyState
              title="Database unavailable"
              description="Start Postgres with docker compose up -d, then run prisma migrate dev."
            />
          </div>
        )}
      </section>


      <Card>
        <CardHeader
          title="Actions"
          description="Recommended demo: Ingest Last 7 Days → Generate RAG + No-RAG Reports → Compare RAG vs No-RAG"
          action={
            stats ? (
              stats.aiStatus === "openai" ? (
                <Badge variant="success">OpenAI enabled</Badge>
              ) : stats.aiStatus === "quota_fallback" ? (
                <Badge variant="warning">OpenAI quota exceeded — mock fallback</Badge>
              ) : (
                <Badge variant="warning">Mock mode (no API key)</Badge>
              )
            ) : undefined
          }
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {actions.map((action) => (
            <div
              key={action.key}
              className="rounded-lg border border-border bg-slate-50 p-4"
            >
              <Button
                variant={action.variant}
                loading={activeAction === action.key}
                onClick={() => runAction(action)}
                className="w-full cursor-pointer"
              >
                {action.label}
              </Button>
              <p className="mt-2 text-xs text-muted">{action.description}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

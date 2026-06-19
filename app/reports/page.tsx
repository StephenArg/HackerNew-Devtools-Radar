"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, Spinner } from "@/components/ui/stat";
import type { ReportSummary } from "@/types";
import { formatDate } from "@/lib/utils";

export default function ReportsPage() {
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/reports");
        const data = (await res.json()) as {
          reports?: ReportSummary[];
          error?: string;
        };
        if (!res.ok) throw new Error(data.error ?? "Failed to load reports");
        setReports(data.reports ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load reports");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  if (loading) {
    return <Spinner label="Loading reports…" />;
  }

  if (error) {
    return (
      <EmptyState
        title="Could not load reports"
        description={error}
        action={
          <Link href="/">
            <Button variant="secondary">Back to Dashboard</Button>
          </Link>
        }
      />
    );
  }

  if (reports.length === 0) {
    return (
      <EmptyState
        title="No reports yet"
        description="Generate your first Community Voices Document from the dashboard."
        action={
          <Link href="/">
            <Button>Go to Dashboard</Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold text-foreground">All Reports</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Every generated Community Voices Document, newest first.{" "}
          <Link href="/report" className="font-medium text-accent hover:underline">
            View latest report
          </Link>
        </p>
      </div>

      <Card>
        <CardHeader
          title="Report history"
          description={`${reports.length} report${reports.length === 1 ? "" : "s"} saved`}
        />
        <ul className="divide-y divide-border">
          {reports.map((report, index) => (
            <li key={report.id}>
              <Link
                href={`/report/${report.id}`}
                className="flex flex-col gap-2 py-4 transition-colors hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between dark:hover:bg-slate-800/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">{report.title}</p>
                  <p className="mt-1 text-xs text-muted">
                    Generated {formatDate(report.createdAt)}
                    {index === 0 && " · Latest"}
                  </p>
                </div>
                <Badge variant={report.mode === "rag" ? "rag" : "noRag"}>
                  {report.mode === "rag" ? "RAG-powered" : "No-RAG baseline"}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

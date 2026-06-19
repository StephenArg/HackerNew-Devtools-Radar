"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ReportPageContent } from "@/components/report-page-content";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/stat";

export default function ReportByIdPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : null;

  if (!id) {
    return (
      <EmptyState
        title="Invalid report link"
        description="This report URL is malformed."
        action={
          <Link href="/reports">
            <Button variant="secondary">View all reports</Button>
          </Link>
        }
      />
    );
  }

  return (
    <ReportPageContent
      reportId={id}
      emptyTitle="Report not found"
      emptyDescription="That report may have been deleted or the link is outdated."
    />
  );
}

import type { Metadata } from "next";
import { DashboardActions } from "@/components/dashboard-actions";
import { Card, CardHeader } from "@/components/ui/card";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default function HomePage() {
  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h2 className="text-3xl font-bold tracking-tight text-foreground">
          Community Voices — HN Devtools Radar
        </h2>
        <h3 className="text-lg font-medium tracking-tight text-foreground">
          Community: Hacker News — Devtools & Indie Builders
        </h3>
        <p className="max-w-3xl text-base leading-relaxed text-muted">
          A local research tool that ingests Hacker News discussions about
          developer tools, AI coding assistants, databases, self-hosting, SaaS,
          open source, and indie products — then generates a weekly Community
          Voices Document powered by RAG.
        </p>
      </section>

      <DashboardActions />

      <div className="flex flex-wrap gap-8">
        <Link href="/report">
          <Button variant="secondary" className="cursor-pointer">View Latest Report</Button>
        </Link>
        <Link href="/reports">
          <Button variant="secondary" className="cursor-pointer">View All Reports</Button>
        </Link>
        <Link href="/compare">
          <Button variant="secondary" className="cursor-pointer">Compare RAG vs No-RAG</Button>
        </Link>
        <Link href="/embeddings">
          <Button variant="secondary" className="cursor-pointer">Explore Embeddings</Button>
        </Link>
        <Link href="/sources">
          <Button variant="secondary" className="cursor-pointer">View Ingested Sources</Button>
        </Link>
      </div>

      <Card>
        <CardHeader
          title="Why Hacker News devtools?"
          description="An active, opinionated community with rich technical debate — ideal for demonstrating retrieval-grounded synthesis vs generic LLM summaries."
        />
        <ul className="grid gap-2 text-sm text-slate-700 md:grid-cols-2">
          <li>• High-signal Show HN and Ask HN threads every week</li>
          <li>• Strong themes: AI coding, Postgres, self-hosting, SaaS pricing</li>
          <li>• Public Algolia API — no auth required for ingestion</li>
          <li>• RAG citations map cleanly to real thread titles</li>
        </ul>
      </Card>

      <Card>
        <CardHeader
          title="How this pipeline works"
          description="From raw Hacker News discussions to a cited Community Voices Document."
        />
        <ol className="grid gap-2 text-sm text-slate-700 md:grid-cols-2">
          <li>
            <span className="font-semibold text-foreground">1.</span> Fetch recent
            HN threads and comments from the past 7 days.
          </li>
          <li>
            <span className="font-semibold text-foreground">2.</span> Score each
            item for devtools/builder relevance (keep matches, drop off-topic
            stories).
          </li>
          <li>
            <span className="font-semibold text-foreground">3.</span> Store relevant
            posts/comments as <span className="font-medium">community documents</span>.
          </li>
          <li>
            <span className="font-semibold text-foreground">4.</span> Split documents
            into <span className="font-medium">embedded snippets</span>.
          </li>
          <li>
            <span className="font-semibold text-foreground">5.</span> Generate
            embeddings and store them in Postgres/pgvector.
          </li>
          <li>
            <span className="font-semibold text-foreground">6.</span> Retrieve
            section-specific snippets for report generation.
          </li>
          <li>
            <span className="font-semibold text-foreground">7.</span> Generate a
            cited RAG Community Voices Document.
          </li>
          <li>
            <span className="font-semibold text-foreground">8.</span> Compare it
            against a no-RAG baseline.
          </li>
        </ol>
      </Card>
    </div>
  );
}

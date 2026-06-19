# Community Voices — HN Devtools Radar

A local full-stack research tool that ingests Hacker News discussions about developer tools, AI coding assistants, databases, self-hosting, SaaS, open source, and indie products — then generates a weekly **Community Voices Document** powered by RAG.

Built as an engineering screening project demonstrating ingestion, vector search, report generation, A/B comparison, and embedding visualization.

## Project Overview

This app:

1. Ingests public Hacker News data via the Algolia API
2. Scores each item for devtools/builder relevance and drops off-topic stories
3. Chunks and embeds relevant community text into PostgreSQL + pgvector
4. Retrieves relevant chunks for section-specific RAG queries
5. Generates a structured weekly report with inline citations across every section
6. Predicts what the community will discuss next week from observed evidence
7. Compares RAG vs no-RAG baselines side-by-side with a single rubric
8. Visualizes embeddings and tracks retrieval frequency / influence

**No auth. No external hosted services required for demo** — mock mode works without an OpenAI API key.

### Community choice

The chosen community is **Hacker News discussions around developer tools, AI
coding, software infrastructure, databases, self-hosting, open-source tooling,
engineering workflows, indie software products, and technical builder products.**
It is active, opinionated, highly technical, and publicly accessible via the
Algolia HN API — ideal for demonstrating retrieval-grounded synthesis.

### Relevance filtering

Ingestion is not "store everything on HN." Each candidate item is scored with a
deterministic keyword/category scorer ([lib/relevance.ts](lib/relevance.ts)):

- Community signals (AI coding, developer tools, databases, self-hosting, open
source, infrastructure, frontend tooling, backend tooling, DevOps/CI-CD,
observability, security, SaaS/pricing, indie products, engineering workflow)
add weight.
- Off-topic signals (politics, energy/nuclear, sports, celebrity, generic
consumer/business/philanthropy news, medical/health, consumer AI image
generation, general science) subtract weight, so trending front-page stories
unrelated to building software are dropped.
- **Two-tier keep rule:** an item is kept if its score is `>= 0.55`, or if its
score is `>= 0.45` **and** the title/text contains a strong devtools-builder
keyword (e.g. `api`, `cli`, `database`, `rag`, `kubernetes`, `open source`,
`self-hosted`, `observability`, `compiler`). Everything else is excluded.
- `ai_coding` is reserved for genuine coding/engineering AI (agents, code review,
IDEs, CLI tools); generic AI news (image generation, medical AI) is never
classified as `ai_coding`.
- Each stored source records `relevanceScore`, `relevanceCategory`, and a
human-readable `relevanceReason`, surfaced on the **Sources** page (with an
expandable "Why kept" note) so reviewers can confirm the app is not ingesting
random Hacker News content.

No extra LLM call is required for relevance (optional embedding blend is gated
behind `RELEVANCE_USE_EMBEDDINGS=true`).

## Local Setup

### Prerequisites

- Node.js 20+
- pnpm
- Docker (for PostgreSQL + pgvector)

> **Note:** `pnpm-workspace.yaml` pre-approves build scripts for Prisma, esbuild, and sharp so `pnpm install` works non-interactively on pnpm 10+.

### Quick Start

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm prisma migrate dev
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), then from the Dashboard click **Ingest Last 7 Days** and **Generate Reports**.

> **Optional:** `pnpm seed` loads sample HN-like data without network calls — useful for offline demos only.

### Demo flow (under 5 minutes, in the browser)

1. Open [http://localhost:3000](http://localhost:3000).
2. Click **Ingest Last 7 Days** to fetch and filter recent HN threads.
3. Click **Generate Reports**.
4. Open **Report** to view the Community Voices Document. Every section is cited;
   each citation pill is clickable and opens the HN discussion thread in a new tab.
   The Source Coverage / Methodology section shows live counts (threads, embedded
   snippets, retrieved snippets used, inline citations, unique cited sources).
5. Open **Compare** to see no-RAG vs RAG with a consistent rubric.
6. Open **Embeddings** to see the PCA/UMAP embedding map and **Most Influential
   Source Snippets** (source titles link out to the original threads).
7. Open **Sources** to inspect ingested HN discussions and their relevance metadata.

> **Mock mode:** If `OPENAI_API_KEY` is missing, the app uses deterministic mock
> embeddings and templated reports so you can still evaluate the workflow without
> external LLM calls. Ingestion still pulls real HN data from Algolia.

### CLI alternative

```bash
pnpm ingest               # Fetch last 7 days from Algolia HN API
pnpm generate:rag          # RAG report with citations
pnpm generate:no-rag       # Generic baseline
```

For offline demos without HN API access, `pnpm seed` loads sample data instead of ingesting.

Then visit:

- `/report` — latest Community Voices Document
- `/compare` — A/B side-by-side
- `/embeddings` — scatter map + Most Influential Source Snippets table
- `/sources` — ingested catalog with relevance category, score, and reason

### With OpenAI

Add your key to `.env`:

```env
OPENAI_API_KEY=sk-...
```

Then optionally run live ingestion from the CLI:

```bash
pnpm ingest
pnpm generate:rag
```

## Why This Community?

Hacker News devtools threads are:

- **Active** — daily Show HN launches and Ask HN debates
- **Technical** — Postgres, AI coding, self-hosting, SaaS pricing
- **Public** — Algolia HN API requires no credentials
- **Ideal for RAG** — citations map cleanly to real thread titles and quotes

## Architecture

```mermaid
flowchart LR
  subgraph ingest [Ingestion]
    HN[Algolia HN API]
    Seed[Demo Seed Data]
    Chunker[Chunk + Topic Labeler]
    Embed[Embedding Service]
  end

  subgraph store [Storage]
    PG[(PostgreSQL + pgvector)]
  end

  subgraph rag [RAG Pipeline]
    Queries[Section Queries]
    Search[Vector Search]
    LLM[Report Generator]
  end

  subgraph ui [Next.js UI]
    Dashboard[Dashboard]
    Report[Report]
    Compare[Compare]
    Map[Embeddings]
  end

  HN --> Chunker
  Seed --> Chunker
  Chunker --> Embed --> PG
  Queries --> Search --> PG
  Search --> LLM --> PG
  PG --> Dashboard
  PG --> Report
  PG --> Compare
  PG --> Map
```



## RAG Pipeline

When generating a RAG report:

1. **Section queries** — themes, complaints, excitement, disagreements, predictions
2. **Embed queries** — OpenAI embeddings or deterministic mock vectors
3. **Retrieve top-k chunks** — pgvector cosine search (or in-memory fallback)
4. **Track retrievals** — `RetrievalEvent` rows + `Chunk.retrievalCount`
5. **Synthesize report** — structured JSON + Markdown with inline citations, an
  analytical research-memo tone, and evidence-grounded predictions
   (`prediction` / `why` / `sources`)
6. **Save report** — `mode=rag` with full content

Citation format: `[Source: Show HN: SQLite tool discussion, similarity 0.82]`.
In the UI these render as clickable pills that resolve to the HN discussion
thread (`buildCitationUrlMap` in [lib/report-voices.ts](lib/report-voices.ts)).

## A/B Testing

The `/compare` page scores both reports on one rubric ([lib/rubric.ts](lib/rubric.ts))
so the rubric table and the quick metrics never contradict each other. Dimensions
(max 100): groundedness (25), specificity (20), citation quality (15), coverage
(15), prediction quality (10), insightfulness (10), clarity (5).

Scores combine deterministic heuristics with optional batched LLM judge scores
(reconciled against measured evidence). A strong RAG report typically lands
~80–90; the no-RAG baseline stays much lower, especially on groundedness and
citation quality, because it has no retrieval, no citations, and no real sources.


| Metric           | RAG                                        | No-RAG        |
| ---------------- | ------------------------------------------ | ------------- |
| Groundedness     | High (citations, voices, retrieved chunks) | Low (generic) |
| Specificity      | Thread-level details                       | Broad trends  |
| Citations        | Inline across every section                | Zero          |
| Retrieved chunks | Tracked                                    | None          |


Generate both report types from the dashboard (**Generate Reports**), then
inspect side-by-side differences.

## Embedding Visualization

The `/embeddings` page plots each chunk at stored `(x, y)` coordinates with a
**PCA / UMAP toggle**:

- **PCA** — linear projection onto the two directions of greatest variance
- **UMAP** — nonlinear layout via `umap-js` that preserves local neighborhoods
- **Mock mode** — deterministic hash-based vectors when no OpenAI key is set

Points are colored by topic (AI Coding, Databases, Self-Hosting, etc.). Hover for preview; click for detail. A table shows the **Most Influential Source Snippets**.

## Retrieval Stats

Every RAG retrieval creates a `RetrievalEvent` with query, similarity score, and optional `reportId`. `Chunk.retrievalCount` increments on each hit. The **Most Influential Source Snippets** table aggregates, per snippet: retrieval count, average similarity, and which report sections it influenced (derived from the section-specific query that retrieved it).

## Environment Variables

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/hn_devtools_radar?schema=public
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
MOCK_MODE=false
```

If `OPENAI_API_KEY` is empty, the app automatically uses **mock mode** (hash-based embeddings + templated reports).

## Commands


| Command                   | Description                           |
| ------------------------- | ------------------------------------- |
| `pnpm dev`                | Start Next.js dev server              |
| `pnpm build`              | Production build                      |
| `pnpm seed`               | Seed demo HN data                     |
| `pnpm ingest`             | Fetch last 7 days from Algolia HN API |
| `pnpm generate:rag`       | Generate RAG report                   |
| `pnpm generate:no-rag`    | Generate no-RAG baseline              |
| `pnpm prisma migrate dev` | Run database migrations               |


## API Routes


| Method | Route                  | Description            |
| ------ | ---------------------- | ---------------------- |
| POST   | `/api/seed`            | Seed demo data         |
| POST   | `/api/clear`           | Clear all data         |
| POST   | `/api/ingest`          | Ingest HN (7 days)     |
| POST   | `/api/reports/both`    | Generate RAG + no-RAG + judge (dashboard) |
| POST   | `/api/reports/rag`     | Generate RAG report    |
| POST   | `/api/reports/no-rag`  | Generate no-RAG report |
| GET    | `/api/stats`           | Dashboard stats        |
| GET    | `/api/reports/latest`  | Latest report          |
| GET    | `/api/reports/compare` | A/B comparison data    |
| GET    | `/api/embeddings`      | Embedding map points   |
| GET    | `/api/sources`         | Source catalog         |


## Tradeoffs

- **Mock embeddings** — deterministic and demo-friendly, not semantically equivalent to OpenAI
- **2D projection** — PCA and UMAP for visualization; not t-SNE or full spectral methods
- **Keyword topic labels** — simple rules, not ML classification
- **Synchronous ingestion** — no background queue; fine for local demo scale (~300–1500 chunks)
- **IVFFlat index** — fast approximate search; requires enough rows to be meaningful

## Future Improvements

- Background job queue for large ingestion runs
- HNSW index tuning and hybrid BM25 + vector search
- t-SNE or richer interactive embedding exploration
- ML-based topic classification
- Scheduled weekly report cron
- Export reports to PDF/Markdown download
- User-configurable community queries

## Tech Stack

- Next.js App Router + TypeScript + TailwindCSS
- Prisma + PostgreSQL + pgvector
- OpenAI API (optional)
- Recharts + umap-js
- Docker Compose


-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Community" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Community_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "createdAtExternal" TIMESTAMP(3) NOT NULL,
    "points" INTEGER,
    "numComments" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "url" TEXT,
    "author" TEXT,
    "createdAtExternal" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Chunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "embeddingJson" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "retrievalCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Chunk_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RetrievalEvent" (
    "id" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "similarity" DOUBLE PRECISION NOT NULL,
    "reportId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RetrievalEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "contentJson" JSONB NOT NULL,
    "markdown" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Source_communityId_idx" ON "Source"("communityId");
CREATE UNIQUE INDEX "Source_platform_externalId_key" ON "Source"("platform", "externalId");
CREATE INDEX "Document_sourceId_idx" ON "Document"("sourceId");
CREATE INDEX "Chunk_documentId_idx" ON "Chunk"("documentId");
CREATE INDEX "Chunk_topic_idx" ON "Chunk"("topic");
CREATE INDEX "Chunk_retrievalCount_idx" ON "Chunk"("retrievalCount");
CREATE INDEX "RetrievalEvent_chunkId_idx" ON "RetrievalEvent"("chunkId");
CREATE INDEX "RetrievalEvent_reportId_idx" ON "RetrievalEvent"("reportId");
CREATE INDEX "Report_communityId_mode_idx" ON "Report"("communityId", "mode");
CREATE INDEX "Report_createdAt_idx" ON "Report"("createdAt");

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Chunk" ADD CONSTRAINT "Chunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RetrievalEvent" ADD CONSTRAINT "RetrievalEvent_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "Chunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RetrievalEvent" ADD CONSTRAINT "RetrievalEvent_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Report" ADD CONSTRAINT "Report_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add vector column to Chunk
ALTER TABLE "Chunk" ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Index for approximate nearest neighbor search
CREATE INDEX IF NOT EXISTS chunk_embedding_idx ON "Chunk" USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

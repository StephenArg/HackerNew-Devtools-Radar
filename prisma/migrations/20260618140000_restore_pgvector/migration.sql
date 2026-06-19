-- Restore the pgvector column dropped by the earlier auto-generated migration
-- (20260618133645). This migration is intentionally timestamped AFTER that drop
-- so the column always exists at the end of a fresh `migrate deploy`.
--
-- The column is managed via raw SQL because Prisma has no native vector type;
-- it is declared as Unsupported("vector(1536)") in schema.prisma so future
-- `migrate dev` runs do not drop it again.

-- Ensure the extension exists
CREATE EXTENSION IF NOT EXISTS vector;

-- Re-add the vector column
ALTER TABLE "Chunk" ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Backfill the vector column from the JSON embeddings already stored on each chunk.
-- embeddingJson is JSON.stringify(number[]), i.e. "[0.1,0.2,...]", which is also
-- pgvector's text input format.
UPDATE "Chunk"
SET embedding = "embeddingJson"::vector
WHERE embedding IS NULL
  AND "embeddingJson" IS NOT NULL
  AND "embeddingJson" <> ''
  AND "embeddingJson" LIKE '[%]';

-- Approximate nearest neighbor index for cosine similarity search
CREATE INDEX IF NOT EXISTS chunk_embedding_idx
  ON "Chunk" USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

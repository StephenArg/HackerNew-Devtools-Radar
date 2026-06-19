/*
  Warnings:

  - You are about to drop the column `embedding` on the `Chunk` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "chunk_embedding_idx";

-- AlterTable
ALTER TABLE "Chunk" DROP COLUMN "embedding";

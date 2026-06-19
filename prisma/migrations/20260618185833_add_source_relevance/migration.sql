-- AlterTable
ALTER TABLE "Source" ADD COLUMN     "relevanceCategory" TEXT,
ADD COLUMN     "relevanceReason" TEXT,
ADD COLUMN     "relevanceScore" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "Source_relevanceCategory_idx" ON "Source"("relevanceCategory");

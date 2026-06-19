-- CreateTable
CREATE TABLE "RubricJudgeCache" (
    "id" TEXT NOT NULL,
    "ragReportId" TEXT NOT NULL,
    "noRagReportId" TEXT NOT NULL,
    "retrievedChunks" INTEGER NOT NULL,
    "judgeScores" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RubricJudgeCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RubricJudgeCache_ragReportId_noRagReportId_key" ON "RubricJudgeCache"("ragReportId", "noRagReportId");

-- CreateIndex
CREATE INDEX "RubricJudgeCache_ragReportId_idx" ON "RubricJudgeCache"("ragReportId");

-- CreateIndex
CREATE INDEX "RubricJudgeCache_noRagReportId_idx" ON "RubricJudgeCache"("noRagReportId");

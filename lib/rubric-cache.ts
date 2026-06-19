import prisma from "@/lib/db";
import type { RubricJudgeScores } from "@/lib/rubric";

export async function getRubricJudgeCache(
  ragReportId: string,
  noRagReportId: string,
): Promise<RubricJudgeScores | null> {
  const row = await prisma.rubricJudgeCache.findUnique({
    where: {
      ragReportId_noRagReportId: { ragReportId, noRagReportId },
    },
  });
  if (!row) return null;
  return row.judgeScores as unknown as RubricJudgeScores;
}

export async function saveRubricJudgeCache(
  ragReportId: string,
  noRagReportId: string,
  retrievedChunks: number,
  judgeScores: RubricJudgeScores,
): Promise<void> {
  await prisma.rubricJudgeCache.upsert({
    where: {
      ragReportId_noRagReportId: { ragReportId, noRagReportId },
    },
    create: {
      ragReportId,
      noRagReportId,
      retrievedChunks,
      judgeScores: judgeScores as object,
    },
    update: {
      retrievedChunks,
      judgeScores: judgeScores as object,
    },
  });
}

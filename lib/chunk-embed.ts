import prisma from "@/lib/db";
import { getEmbeddings, projectTo2D } from "@/lib/ai";
import { assignTopic } from "@/lib/topics";
import { storeChunkEmbedding } from "@/lib/vector";

export interface ChunkToEmbed {
  documentId: string;
  text: string;
  title: string;
}

export async function createChunksWithEmbeddings(
  items: ChunkToEmbed[],
): Promise<number> {
  if (items.length === 0) return 0;

  const embeddings = await getEmbeddings(items.map((item) => item.text));
  let created = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const embedding = embeddings[i];
    const { x, y } = projectTo2D(embedding);
    const topic = assignTopic(item.text, item.title);

    const chunk = await prisma.chunk.create({
      data: {
        documentId: item.documentId,
        text: item.text,
        embeddingJson: JSON.stringify(embedding),
        topic,
        x,
        y,
      },
    });

    await storeChunkEmbedding(chunk.id, embedding);
    created++;
  }

  return created;
}

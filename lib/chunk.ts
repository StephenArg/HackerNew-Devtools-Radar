import { CHUNK_WORDS_MAX, CHUNK_WORDS_MIN } from "@/lib/constants";

export function chunkText(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= CHUNK_WORDS_MAX) {
    return [text.trim()];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < words.length) {
    const end = Math.min(start + CHUNK_WORDS_MAX, words.length);
    const slice = words.slice(start, end).join(" ");
    if (slice.split(/\s+/).length >= CHUNK_WORDS_MIN || chunks.length === 0) {
      chunks.push(slice.trim());
    } else if (chunks.length > 0) {
      chunks[chunks.length - 1] += ` ${slice.trim()}`;
    }
    start = end - 20; // overlap
    if (start < 0) start = 0;
    if (end >= words.length) break;
  }

  return chunks.filter(Boolean);
}

/** Mouth openness (0..1) imitating speech: ~4 syllables/s with slower phrase-level swell. */
export function speechEnvelope(ms: number): number {
  const t = ms / 1000;
  const syllable = Math.abs(Math.sin(t * Math.PI * 4.3)) * (0.65 + 0.35 * Math.sin(t * 9.1));
  const phrase = 0.6 + 0.4 * Math.sin(t * 1.7);
  return Math.min(1, Math.max(0, syllable * phrase + 0.08));
}

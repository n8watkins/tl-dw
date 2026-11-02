/**
 * Whether a composer holds the whole prompt. Rich editors turn newlines into
 * paragraphs (and may collapse spaces), so whitespace is ignored; then both the
 * start and the END of the prompt must be there, and nearly all of its length.
 * Checking only the start passes a prompt a site silently cut short, which
 * drops the transcript's end and anything after it.
 */
export function promptInsertedWhole(composerText: string, prompt: string): boolean {
  const got = composerText.replace(/\s+/g, "");
  const want = prompt.replace(/\s+/g, "");
  if (!want) return true;
  const probe = Math.min(60, want.length);
  return (
    got.includes(want.slice(0, probe)) &&
    got.includes(want.slice(want.length - probe)) &&
    got.length >= want.length * 0.98
  );
}

/** How much of the prompt (0 to 1, by non-space characters) a composer holds. */
export function insertedShare(composerText: string, prompt: string): number {
  const want = prompt.replace(/\s+/g, "").length;
  if (!want) return 1;
  return Math.min(1, composerText.replace(/\s+/g, "").length / want);
}

/**
 * Wording for a destination tab TL;DW couldn't fill, as shown on the YouTube
 * page. Plain sentences, no nested asides, and it only promises the clipboard
 * when the destination tab says the copy worked.
 */

/**
 * Why the fill failed when the site's message box never appeared. Like every
 * fill-failure reason it reads after the site's name ("Gemini never showed..."),
 * as the popup shows it.
 */
export const COMPOSER_MISSING_REASON = "never showed its message box. If you're signed out, sign in there first";

export type FillFailure = {
  site: string;
  /** What went wrong, read after the site's name, without a final period. */
  reason?: string;
  /** Set when the site kept only part of the prompt: the share it kept, in percent. */
  keptPercent?: number;
  /** Whether the destination tab put the full prompt on the clipboard. */
  copied?: boolean;
};

export function fillFailureMessage({ site, reason, keptPercent, copied }: FillFailure): string {
  const what = keptPercent !== undefined
    ? `${site} took only about ${keptPercent}% of the prompt (it was too long), so nothing was sent.`
    : reason
      ? `TL;DW couldn't fill the ${site} tab. ${site} ${reason.trim().replace(/[.\s]+$/, "")}.`
      : `TL;DW couldn't fill the ${site} tab.`;
  if (copied === true) return `${what} The full prompt is on your clipboard: paste it into the ${site} tab.`;
  if (copied === false) {
    return `${what} To send it yourself, open the ${site} tab and click "Copy prompt", then paste it there.`;
  }
  return what;
}

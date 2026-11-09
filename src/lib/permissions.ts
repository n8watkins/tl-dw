/**
 * Host access TL;DW asks for only when a feature needs it. The base install
 * covers YouTube, the Gemini web app and the Gemini API; SponsorBlock is the
 * one optional host permission, requested when the user turns it on (a click,
 * which Chrome requires for the prompt).
 */
export const SPONSORBLOCK_ORIGINS: readonly string[] = ["https://sponsor.ajay.app/*"];

async function contains(origins: readonly string[]): Promise<boolean> {
  if (origins.length === 0) return true;
  try {
    return await chrome.permissions.contains({ origins: [...origins] });
  } catch {
    return false;
  }
}

/** Ask for `origins`. Call it straight from a click handler; Chrome needs the user gesture. */
async function request(origins: readonly string[]): Promise<boolean> {
  if (origins.length === 0) return true;
  try {
    return await chrome.permissions.request({ origins: [...origins] });
  } catch {
    return false;
  }
}

export function hasSponsorBlockAccess(): Promise<boolean> {
  return contains(SPONSORBLOCK_ORIGINS);
}

export function requestSponsorBlockAccess(): Promise<boolean> {
  return request(SPONSORBLOCK_ORIGINS);
}

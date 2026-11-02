/**
 * Host access TL;DW asks for only when a feature needs it. The base install
 * covers YouTube, the Gemini web app and the Gemini API; the other chat sites
 * and SponsorBlock are optional host permissions requested at the moment the
 * user picks them (a click, which Chrome requires for the prompt).
 */
export const OPTIONAL_DESTINATION_ORIGINS: Readonly<Record<string, readonly string[]>> = {
  chatgpt: ["https://chatgpt.com/*"],
  claude: ["https://claude.ai/*"],
  notebooklm: ["https://notebooklm.google.com/*"],
};

export const SPONSORBLOCK_ORIGINS: readonly string[] = ["https://sponsor.ajay.app/*"];

/** The origins a destination needs beyond the base install (none for Gemini). */
export function destinationOrigins(destinationId: string): string[] {
  return [...(OPTIONAL_DESTINATION_ORIGINS[destinationId] ?? [])];
}

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

export function hasDestinationAccess(destinationId: string): Promise<boolean> {
  return contains(destinationOrigins(destinationId));
}

export function requestDestinationAccess(destinationId: string): Promise<boolean> {
  return request(destinationOrigins(destinationId));
}

export function hasSponsorBlockAccess(): Promise<boolean> {
  return contains(SPONSORBLOCK_ORIGINS);
}

export function requestSponsorBlockAccess(): Promise<boolean> {
  return request(SPONSORBLOCK_ORIGINS);
}

/** "TL;DW needs access to chatgpt.com…": what the page says when a send is refused for it. */
export function accessNeededMessage(site: string, destinationId: string): string {
  const host = destinationOrigins(destinationId)[0]?.replace(/^https:\/\/|\/\*$/g, "") ?? site;
  return `TL;DW needs your permission to open ${site} (${host}) and type the prompt there. ` +
    "Allow it in TL;DW settings, or send to Gemini instead.";
}

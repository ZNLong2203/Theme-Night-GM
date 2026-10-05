import type { EntityCard, Night } from "./types";

const MAJOR_IP_HOLDERS =
  /disney|pixar|marvel|lucasfilm|warner|dc studios|universal|dreamworks|illumination|paramount|sony|netflix|hbo|nintendo|pok[eé]mon|mojang|microsoft|epic games|mattel|hasbro|nickelodeon|apple|amazon|lionsgate|legendary|bbc|fx|abc|nbc|cbs|peacock|bandai/i;

/**
 * Theme nights built on studio IP usually need a license (often via the league's partnership desk).
 * This is a rules-based flag, not legal advice — the UI says so.
 */
export function licensingFor(anchor: EntityCard, policy: "licensed_ok" | "ip_light"): Night["licensing"] {
  const owner = anchor.owners?.find((o) => MAJOR_IP_HOLDERS.test(o));
  if (anchor.kind === "artist") {
    return {
      risk: "medium",
      note: `Playing ${anchor.name}'s music is typically covered by the venue's performance licenses; using the artist's name, likeness or logos in marketing needs approval. Frame it as a "${anchor.name}-inspired" night or pitch the artist's team.`,
    };
  }
  if (owner) {
    return {
      risk: "high",
      note:
        policy === "ip_light"
          ? `${owner} owns this IP. Run it as an "inspired-by" night (no logos, characters or titles in creative), or request a license through your league's partnership desk.`
          : `${owner} owns this IP. Request a license (leagues often have studio partnerships) before using titles, logos or characters.`,
    };
  }
  if (anchor.kind === "brand") {
    return { risk: "medium", note: `Brand-led night: needs ${anchor.name}'s sign-off — which is also your sponsorship pitch.` };
  }
  return {
    risk: "low",
    note: "No major studio or publisher detected in Qloo's metadata. Still confirm with the rights holder before using logos or characters.",
  };
}

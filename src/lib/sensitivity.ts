import type { EntityCard } from "./types";

/**
 * Topics that make a poor (or hurtful) ballpark theme night regardless of local affinity:
 * politics, religion, violence and tragedy. Qloo surfaces what a market reads and watches —
 * a GM still has to use judgment, so these anchors are flagged to the agent and rejected by the
 * plan validator.
 *
 * Titles and descriptions are checked against the full list. Qloo keyword tags are noisier (a family
 * film can carry a "death" tag), so tags are only checked against the unambiguous subset.
 */
const IN_TITLE =
  /\b(politic\w*|election|president\w*|senator|congress|campaign|partisan|war|genocide|holocaust|slavery|apartheid|racis\w*|lynch\w*|terror\w*|religio\w*|church|bible|gospel|islam\w*|jihad|abortion|suicide|funeral|murder\w*|crime|serial killer|assassinat\w*)\b/i;
const IN_TAGS = /^(politics|political\w*|religion|religious|christian\w*|war|terrorism|true crime|crime|genocide|holocaust|slavery)$/i;

export function sensitiveTopic(card: Pick<EntityCard, "name" | "tags" | "subtitle">): string | undefined {
  for (const text of [card.name, card.subtitle ?? ""]) {
    const match = text.match(IN_TITLE);
    if (match) return match[0].toLowerCase();
  }
  const tag = card.tags?.find((t) => IN_TAGS.test(t.trim()));
  return tag?.toLowerCase();
}

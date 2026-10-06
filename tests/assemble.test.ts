import { describe, expect, it } from "vitest";
import { assemblePlan, PlanSubmission } from "@/lib/agent/assemble";
import type { RunContext } from "@/lib/agent/tools";
import { QlooRecorder } from "@/lib/qloo/client";
import { TasteContext } from "@/lib/qloo/workflows";
import { computeScore } from "@/lib/scoring";
import type { EntityCard, GameDate, TeamConfig } from "@/lib/types";

const RUN_ID = "3d63e9ef-0016-4d4f-adad-2ee3dd6bc29a";

const VENUE = { name: "Downtown ballpark, Durham", city: "Durham, North Carolina", lat: 35.9916, lon: -78.9045 };

const SANDLOT: EntityCard = { id: "M-SANDLOT", name: "The Sandlot", kind: "movie", owners: ["Island World"] };
const MOANA: EntityCard = { id: "M-MOANA", name: "Moana 2", kind: "movie", owners: ["Walt Disney Pictures"] };
const ELECTION: EntityCard = { id: "T-ELECTION", name: "Election Night Live", kind: "tv_show" };
const ARTIST: EntityCard = { id: "A-COLE", name: "J. Cole", kind: "artist" };
const STONE: EntityCard = { id: "B-STONE", name: "Stone Brewing Company", kind: "brand", industries: ["Alcoholic Beverages"] };
const CHEERWINE: EntityCard = { id: "B-CHEER", name: "Cheerwine", kind: "brand", industries: ["Soft Drinks"] };
const SODAS: EntityCard[] = ["Sun Drop", "Pepsi", "Dr Pepper"].map((name, i) => ({ id: `B-SODA${i}`, name, kind: "brand", industries: ["Soft Drinks"] }));
const PLACE: EntityCard = { id: "P-MOTORCO", name: "Motorco Music Hall", kind: "place" };
const PODCAST: EntityCard = { id: "POD-PMT", name: "Pardon My Take", kind: "podcast" };
const TAPROOM: EntityCard = { id: "P-TAPROOM", name: "Bull City Taproom", kind: "place", tags: ["Brewery"] };
const CRIME_POD: EntityCard = { id: "POD-CRIME", name: "Crime Junkie", kind: "podcast" };

const TARGETS: GameDate[] = [
  { date: "2027-04-06", weekday: "Tue", time: "night", target: true, segment: "families" },
  { date: "2027-04-21", weekday: "Wed", time: "night", target: true, segment: "boomers" },
];

function makeRun(): RunContext {
  const taste = new TasteContext(new QlooRecorder(), VENUE.city, VENUE, "baseball");
  taste.remember([SANDLOT, MOANA, ELECTION, ARTIST, STONE, CHEERWINE, ...SODAS, PLACE, PODCAST, TAPROOM, CRIME_POD]);

  taste.localPct.set(SANDLOT.id, 0.9);
  taste.segmentFit.set(SANDLOT.id, { families: 0.8, boomers: 0.6 });
  taste.fanOverlap.set(SANDLOT.id, 0.25);
  taste.profiles.set(SANDLOT.id, {
    entity: SANDLOT,
    evidence: ["Q3"],
    trend: { points: [], direction: "rising", changePct: 20 },
    heat: { points: [], nearVenueIndex: 0.8, catchmentKm: 16 },
  });
  taste.localPct.set(MOANA.id, 0.7);
  taste.segmentFit.set(MOANA.id, { boomers: 0.5 });

  taste.cite(SANDLOT.id, "Q10", "Q2");
  taste.cite(MOANA.id, "Q4");
  taste.cite(CHEERWINE.id, "Q12");
  taste.cite(STONE.id, "Q11");
  taste.cite(ARTIST.id, "Q3");
  taste.cite(PLACE.id, "Q7");
  taste.cite(PODCAST.id, "Q9");

  const team: TeamConfig = {
    teamName: "Bull City Ballclub",
    sport: "baseball",
    league: "Triple-A (MiLB)",
    venue: VENUE,
    dates: TARGETS,
    ipPolicy: "ip_light",
    sponsorCategories: ["Beverages"],
  };
  return {
    id: RUN_ID,
    taste,
    team,
    targets: TARGETS.map((t) => ({ ...t })),
    mode: { qloo: "simulated", llm: "autopilot" },
    emit: () => {},
    kits: new Map(),
  };
}

const night = (overrides: Record<string, unknown> = {}) => ({
  date: "2027-04-06",
  anchor_entity_id: SANDLOT.id,
  title: "Sandlot Summer Night",
  tagline: "Heroes get remembered, legends never die.",
  why: "Ranks #1 locally vs #9 nationally.",
  promo: { headline: "Sandlot Night", social: "Grab your glove.", email_subject: "You're invited" },
  ...overrides,
});

const second = (overrides: Record<string, unknown> = {}) =>
  night({ date: "2027-04-21", anchor_entity_id: MOANA.id, title: "Island Voyage Night", ...overrides });

const submit = (...nights: ReturnType<typeof night>[]) => PlanSubmission.parse({ market_summary: "Durham over-indexes on baseball films.", nights });

describe("assemblePlan", () => {
  it("builds a plan from a valid submission: sorted nights, computed scores, collected evidence", () => {
    const run = makeRun();
    const { plan, errors, warnings } = assemblePlan(
      run,
      submit(
        second(),
        night({
          sponsor_picks: [{ brand_id: CHEERWINE.id, angle: "Durham's own soda for a Durham classic." }],
          playlist_artist_ids: [ARTIST.id],
          local_partner_picks: [{ place_id: PLACE.id, idea: "Pre-game screening" }],
          media_partner: { podcast_id: PODCAST.id, idea: "Ad read + ticket giveaway" },
        }),
      ),
    );

    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(plan).toBeDefined();
    if (!plan) return;

    expect(plan.nights.map((n) => n.date)).toEqual(["2027-04-06", "2027-04-21"]);
    expect(plan.marketSummary).toBe("Durham over-indexes on baseball films.");
    expect(plan.team).toBe(run.team);
    expect(plan.mode).toEqual(run.mode);
    expect(plan.requests).toBe(run.taste.recorder.logs);
    expect(plan.id).toBe(RUN_ID);

    const [sandlot, moana] = plan.nights;
    expect(sandlot).toMatchObject({ weekday: "Tue", time: "night", segment: "families", title: "Sandlot Summer Night" });
    expect(sandlot.anchor.id).toBe(SANDLOT.id);
    // 100 * (0.3*0.9 + 0.25*0.8 + 0.2*0.8 + 0.15*1 + 0.1*0.8)
    expect(sandlot.score.total).toBe(86);
    expect(sandlot.score).toEqual(
      computeScore({
        entity: SANDLOT,
        segment: "families",
        localAffinity: 0.9,
        profile: run.taste.profiles.get(SANDLOT.id),
        segmentFit: { families: 0.8, boomers: 0.6 },
        fanOverlap: 0.25,
      }),
    );
    expect(moana.score).toEqual(computeScore({ entity: MOANA, segment: "boomers", localAffinity: 0.7, segmentFit: { boomers: 0.5 } }));

    // Anchor + sponsor + playlist + partner + media evidence, sorted by request number (not as strings).
    expect(sandlot.evidence).toEqual(["Q2", "Q3", "Q7", "Q9", "Q10", "Q12"]);
    expect(moana.evidence).toEqual(["Q4"]);

    expect(sandlot.sponsors).toEqual([{ brand: expect.objectContaining({ id: CHEERWINE.id }), angle: "Durham's own soda for a Durham classic." }]);
    expect(sandlot.playlist.map((a) => a.id)).toEqual([ARTIST.id]);
    expect(sandlot.localPartners).toEqual([{ place: expect.objectContaining({ id: PLACE.id }), idea: "Pre-game screening" }]);
    expect(sandlot.mediaPartner).toEqual({ podcast: expect.objectContaining({ id: PODCAST.id }), idea: "Ad read + ticket giveaway" });
    expect(sandlot.promo).toEqual({ headline: "Sandlot Night", social: "Grab your glove.", emailSubject: "You're invited" });

    expect(sandlot.licensing.risk).toBe("low");
    expect(moana.licensing.risk).toBe("high");

    // Only anchors with a measured profile are attached, with this run's segment fit.
    expect(plan.profiles).toHaveLength(1);
    expect(plan.profiles[0]).toMatchObject({ entity: { id: SANDLOT.id }, segmentFit: { families: 0.8, boomers: 0.6 } });
  });

  it("resolves an anchor by exact name when the model passes a name instead of an ID", () => {
    const { plan, errors } = assemblePlan(makeRun(), submit(night({ anchor_entity_id: "  the sandlot " }), second()));
    expect(errors).toEqual([]);
    expect(plan?.nights[0].anchor.id).toBe(SANDLOT.id);
  });

  it("rejects an anchor ID that no Qloo tool returned", () => {
    const { plan, errors } = assemblePlan(makeRun(), submit(night({ anchor_entity_id: "M-INVENTED" }), second()));
    expect(plan).toBeUndefined();
    // The date was attempted, so it is reported once (as the bad anchor), not also as missing.
    expect(errors).toEqual(['anchor_entity_id "M-INVENTED" on 2027-04-06 was not returned by any Qloo tool call']);
  });

  it("rejects an anchor that touches a sensitive topic", () => {
    const { plan, errors } = assemblePlan(makeRun(), submit(night({ anchor_entity_id: ELECTION.id }), second()));
    expect(plan).toBeUndefined();
    expect(errors[0]).toContain('Election Night Live on 2027-04-06 touches a sensitive topic ("election")');
  });

  it("rejects identity-framed titles and taglines", () => {
    const byTitle = assemblePlan(makeRun(), submit(night({ title: "Durham Pride Night" }), second()));
    expect(byTitle.plan).toBeUndefined();
    expect(byTitle.errors[0]).toContain('"Durham Pride Night" on 2027-04-06 frames the night around identity ("pride")');

    const byTagline = assemblePlan(makeRun(), submit(night(), second({ tagline: "Celebrate our island heritage" })));
    expect(byTagline.plan).toBeUndefined();
    expect(byTagline.errors[0]).toContain('("heritage")');
  });

  it("removes alcohol sponsors from family and Gen Z nights but keeps them for adult crowds", () => {
    const run = makeRun();
    const sponsors = [
      { brand_id: STONE.id, angle: "Craft beer garden" },
      { brand_id: CHEERWINE.id, angle: "Local soda" },
    ];
    const { plan, warnings } = assemblePlan(run, submit(night({ sponsor_picks: sponsors }), second({ sponsor_picks: sponsors })));

    expect(plan).toBeDefined();
    expect(warnings).toEqual(["Removed sponsor Stone Brewing Company from the families night on 2027-04-06: it is an alcohol brand"]);
    expect(plan!.nights[0].sponsors.map((s) => s.brand.id)).toEqual([CHEERWINE.id]);
    expect(plan!.nights[1].sponsors.map((s) => s.brand.id)).toEqual([STONE.id, CHEERWINE.id]);
    // Removed sponsors don't contribute evidence.
    expect(plan!.nights[0].evidence).not.toContain("Q11");

    const genZ = makeRun();
    genZ.targets[1].segment = "gen_z";
    const result = assemblePlan(genZ, submit(night(), second({ sponsor_picks: sponsors })));
    expect(result.warnings).toEqual(["Removed sponsor Stone Brewing Company from the gen_z night on 2027-04-21: it is an alcohol brand"]);
  });

  it("drops bars as partners on young-crowd nights and sensitive podcasts on any night", () => {
    const partners = { local_partner_picks: [{ place_id: TAPROOM.id, idea: "Pre-game" }, { place_id: PLACE.id, idea: "Screening" }] };
    const media = { media_partner: { podcast_id: CRIME_POD.id, idea: "Ad read" } };
    const { plan, warnings } = assemblePlan(makeRun(), submit(night({ ...partners, ...media }), second(partners)));
    expect(plan!.nights[0].localPartners.map((p) => p.place.id)).toEqual([PLACE.id]);
    expect(plan!.nights[0].mediaPartner).toBeUndefined();
    // Adults' night keeps the taproom.
    expect(plan!.nights[1].localPartners.map((p) => p.place.id)).toEqual([TAPROOM.id, PLACE.id]);
    expect(warnings).toEqual([
      "Removed local partner Bull City Taproom from the families night on 2027-04-06: it is a bar or brewery",
      'Removed media partner Crime Junkie from the families night on 2027-04-06: it touches a sensitive topic ("crime")',
    ]);
  });

  it("rejects brands, places and podcasts as anchors", () => {
    const { plan, errors } = assemblePlan(makeRun(), submit(night({ anchor_entity_id: CHEERWINE.id }), second()));
    expect(plan).toBeUndefined();
    expect(errors[0]).toContain("Cheerwine on 2027-04-06 is a brand");
  });

  it("caps sponsors at three per night", () => {
    const picks = [CHEERWINE, ...SODAS].map((b) => ({ brand_id: b.id, angle: "Pitch" }));
    const { plan } = assemblePlan(makeRun(), submit(night({ sponsor_picks: picks }), second()));
    expect(plan!.nights[0].sponsors.map((s) => s.brand.id)).toEqual([CHEERWINE.id, SODAS[0].id, SODAS[1].id]);
  });

  it("drops unknown supporting entities, sponsors, artists, places and podcasts with warnings", () => {
    const { plan, errors, warnings } = assemblePlan(
      makeRun(),
      submit(
        night({
          supporting_entity_ids: ["X-1"],
          sponsor_picks: [{ brand_id: "X-2", angle: "?" }],
          playlist_artist_ids: ["X-3"],
          local_partner_picks: [{ place_id: "X-4", idea: "?" }],
          media_partner: { podcast_id: "X-5", idea: "?" },
        }),
        second(),
      ),
    );
    expect(errors).toEqual([]);
    expect(warnings).toEqual([
      'Dropped unknown supporting entity "X-1" on 2027-04-06',
      'Dropped unknown sponsor "X-2" on 2027-04-06',
      'Dropped unknown artist "X-3" on 2027-04-06',
      'Dropped unknown place "X-4" on 2027-04-06',
      "Dropped unknown podcast on 2027-04-06",
    ]);
    expect(plan!.nights[0]).toMatchObject({ supporting: [], sponsors: [], playlist: [], localPartners: [], mediaPartner: undefined });
  });

  it("rejects dates that aren't targets, duplicates and missing nights", () => {
    const offTarget = assemblePlan(makeRun(), submit(night(), second(), night({ date: "2027-05-01" })));
    expect(offTarget.plan).toBeUndefined();
    expect(offTarget.errors).toEqual(["2027-05-01 is not a target date (valid: 2027-04-06, 2027-04-21)"]);

    const duplicate = assemblePlan(makeRun(), submit(night(), night({ anchor_entity_id: MOANA.id })));
    expect(duplicate.plan).toBeUndefined();
    expect(duplicate.errors).toEqual(["2027-04-06 appears twice", "Missing nights for target dates: 2027-04-21"]);
  });

  it("warns when the same anchor carries more than one night", () => {
    const { plan, warnings } = assemblePlan(makeRun(), submit(night(), second({ anchor_entity_id: SANDLOT.id })));
    expect(plan).toBeDefined();
    expect(warnings).toContain("Some anchors repeat — consider more variety.");
  });
});

describe("PlanSubmission", () => {
  it("fills optional fields with defaults", () => {
    const parsed = submit(night());
    expect(parsed.nights[0]).toMatchObject({
      supporting_entity_ids: [],
      sponsor_picks: [],
      giveaway: "",
      activations: [],
      playlist_artist_ids: [],
      local_partner_picks: [],
    });
  });

  it("requires at least one night and a promo block", () => {
    expect(PlanSubmission.safeParse({ market_summary: "x", nights: [] }).success).toBe(false);
    const noPromo: Record<string, unknown> = night();
    delete noPromo.promo;
    expect(PlanSubmission.safeParse({ market_summary: "x", nights: [noPromo] }).success).toBe(false);
  });
});

# Problem Space: Theme Nights for Weak Home Dates

> For judges scoring **Potential Impact** and **Quality of Idea**. Every external fact links to its source. Every product claim links to the code that implements it.

## 1. Promotions are how clubs fill weak dates

- **Promotions move attendance.** In a data set of 1,500 MLB attendance observations, a promotion raised single-game attendance by about 14%. Adding more promotion days dilutes each one, but the extra day still comes out ahead ([McDonald & Rascher, *Journal of Sport Management*, 2000](https://repository.usfca.edu/ess/1)).
- **The effect is larger on weekdays.** For the State College Spikes (2006–2011), fireworks raised attendance 30% on weekdays and 20.3% on weekends. Giveaways raised it 13% on weekdays and 12.3% on weekends. The authors found that entertainment around the game affects attendance more than win–loss record or weather ([Baumgardner & Gallagher, Penn State News, 2017](https://www.psu.edu/news/research/story/researchers-study-importance-nongame-entertainment-minor-league-baseball)).
- **Weekends draw; Mondays don't.** In the 2006 Carolina League, Friday and Saturday games raised attendance and Monday games lowered it. Fireworks, merchandise and discounted food or drink promotions raised it too ([Cebula, Toma & Carmichael, *Applied Economics*, 2009](https://scholars.georgiasouthern.edu/en/publications/attendance-and-promotions-in-minor-league-baseball-the-carolina-l/)).
- **April is weak too.** "April is traditionally the lowest-drawing month of the Minor League season, due to cold weather and the fact that school is still in session" ([MiLB.com, 2010](https://www.milb.com/news/gcs-9823922)). April is "always an uphill battle" ([Ballpark Digest, 2017](https://ballparkdigest.com/2017/05/08/if-its-may-it-means-bigger-milb-crowds/)).

## 2. Who plans them, and when

- **A promotions manager runs the calendar.** An August 2026 posting for *Manager, Game Day Promotions & Programming* at the Hub City Spartanburgers (High-A) lists the main duties. The manager oversees "promotional calendar creation and maintenance" and plans theme nights "with the intent to secure sponsors and drive ticket sales". The role also works with Group Sales on theme nights that "generate group sales opportunities" ([job posting](https://www.hollylist.com/job/manager-game-day-promotions-programming-57463-z29DWPaAHszMmFriD)).
- **Clubs review the season after it ends, and ideas spread from club to club.** MiLB's annual Promotional Seminar meets after the season; the 2013 edition ran in late September. Clubs used it to "plan for the future" by asking "What worked, what didn't, and why?" MiLB's recap predicted that one club's giveaway was "almost sure to be emulated by other teams next season and beyond" ([MiLB.com, 2013](https://www.milb.com/news/gcs-61834440)).

**The gap:** Staff plan from past results and other clubs' ideas. Neither tells them whether *their* market loves a theme more than other markets do, whether those fans live near the venue, or whether the theme suits a Tuesday crowd.

## 3. Sponsorship is built into the night

- The same posting asks the manager to coordinate promotions with the Corporate Partnerships manager "to ensure all contracts … are executed and satisfied" and to run promotions "both sponsored and non-sponsored" ([job posting](https://www.hollylist.com/job/manager-game-day-promotions-programming-57463-z29DWPaAHszMmFriD)).
- Giveaways are increasingly sponsor-driven. SponsorUnited reports that 1,500 brands sponsor take-home items across major pro sports, the WNBA, NWSL and MiLB, a 65% increase since 2021 ([SponsorUnited, 2025](https://www.sponsorunited.com/insights/why-bobblehead-giveaways-thrive-in-mlb-but-lag-in-other-leagues)).

A theme night is therefore also a sales asset, and the club needs a reason why a particular brand should present it.

## 4. Licensing is a real constraint

- **Licensed:** MiLB's three-year deal with Marvel Entertainment called for 96 teams to host at least one Marvel Super Hero-themed game in each of the 2022–2024 seasons, wearing Marvel-branded jerseys ([MiLB, 2021](https://www.milb.com/news/milb-press-release-defenders-of-the-diamond)).
- **Unlicensed:** The Shreveport Mudbugs hockey club received a cease-and-desist letter from the production company and turned its "Harry Potter night" into "Wizard Night" ([KEEL, 2019](https://710keel.com/mudbugs-change-harry-potter-night-to-wizards-night/)).

## 5. Addressable market

These figures count clubs, not budgets.

| Segment | Clubs / schools | Source |
|---|---|---|
| Affiliated MiLB (Triple-A to Low-A) | 120 | [MLB, Feb 12 2021](https://www.mlb.com/press-release/press-release-mlb-announces-new-modernized-player-development-system-and-the-120) |
| AHL (2026–27) | 32 | [AHL](https://theahl.com/news/ahl-unveils-2026-27-schedule) |
| ECHL (2026–27) | 30 | [ECHL](https://echl.com/news/2026/09/echl-announces-preseason-schedule) |
| NBA G League (2025–26) | 31 | [NBA](https://pr.nba.com/2025-26-nba-g-league-schedule/) |
| USL Championship (2026) | 25 | [USL release](https://www.oursportscentral.com/services/releases/usl-championship-confirms-2026-season-structure/n-6307745) |
| USL League One (2026) | 18 | [WATE, Dec 2025](https://digital-release.wate.com/?p=2809511) |
| NCAA Division I (Sept 2026) | 361 active, incl. 136 FBS (68 autonomy + 68 non-autonomy) | [NCAA](https://www.ncaa.org/about-us/membership-directory/membership-composition-and-sport-sponsorship/) |

That makes 256 professional clubs across the six leagues listed, plus Division I athletic departments.

## 6. How Theme Night GM fits the workflow

| Pain point | Feature | Code |
|---|---|---|
| Finding the weak dates | `weaknessScore` adds +3 for Mon–Wed, +2 for Thu, +1 for a Sunday night game, +1.5 for Apr/May/Sep and +1 for Nov/Jan/Feb, and subtracts 3 for Fri/Sat. `pickWeakDates` spaces picks at least 9 days apart and rotates audience segments. Staff can click any date to override. | [schedule.ts](../src/lib/schedule.ts), [team-setup.tsx](../src/components/studio/team-setup.tsx) |
| Same themes as every club | `scan_market_taste` queries `/v2/insights` for five domains with `signal.location.query`, `filter.popularity.min` (default 0.8) and, for movies, TV and artists, `bias.trends`. It computes *local lift*: the rank by national popularity minus the rank by local affinity, within the same result set. **Market DNA** shows two cities' top lists side by side: what they share and what only one of them loves. | [workflows.ts](../src/lib/qloo/workflows.ts), [tools.ts](../src/lib/agent/tools.ts), [market-dna.ts](../src/lib/market-dna.ts) |
| Do the fans live nearby, and is interest growing? | `profile_fandoms` pulls `urn:heatmap` within 40 km of the venue (`filter.location.radius` 40000). `nearVenueIndex` compares the 16 km catchment's share of the fandom's hotspots (the top 20% of heatmap cells) with its share of all cells (0.5 = a fair share). A 16-week `/v2/trending` window (the latest with data in the hackathon dataset) gives the direction. | [workflows.ts](../src/lib/qloo/workflows.ts) |
| A Tuesday crowd is not a Saturday crowd | `score_audience_fit` re-ranks the shortlist inside each domain's city pool with `signal.demographics.age`, or for families a Qloo life-stage audience (`signal.demographics.audiences`, falling back to ages `30_to_34,35_to_44`), and blends that rank with `urn:demographics`. | [workflows.ts](../src/lib/qloo/workflows.ts) |
| Bringing in new fans | Fan-base overlap is how highly a sport proxy entity's audience ranks the fandom. In the Taste Fit Score, `newFanReach = 1 − 0.8 × overlap`. | [workflows.ts](../src/lib/qloo/workflows.ts), [scoring.ts](../src/lib/scoring.ts) |
| Selling the sponsor | `find_sponsors` turns each of the club's sales categories (up to 6) into a Qloo brand tag (`/v2/tags`) and finds brands in each that share the fandom's taste (`filter.tags`, `feature.explainability`), excluding leagues, teams and sports media. Each night has a copyable pitch and a printable sponsor one-pager. The prompt limits each brand to two nights. | [workflows.ts](../src/lib/qloo/workflows.ts), [season-board.tsx](../src/components/studio/season-board.tsx), [prompt.ts](../src/lib/agent/prompt.ts) |
| Building the night | `build_night_experience` returns playlist artists, bars, restaurants, breweries and cafés within 6 km (`filter.location.radius` 6000), and podcasts. | [workflows.ts](../src/lib/qloo/workflows.ts) |
| Licensing risk | `licensingFor` flags an anchor when Qloo's ownership metadata names a major IP holder. Under the `ip_light` policy, the prompt asks for night titles that avoid trademarked names, and the flag suggests running an "inspired-by" night. | [licensing.ts](../src/lib/licensing.ts), [prompt.ts](../src/lib/agent/prompt.ts) |
| A night the community or sponsors would object to | The validator requires a movie, TV show, artist, video game or book as the anchor, rejects political, religious, crime or tragedy anchors and identity-framed nights (pride, heritage, faith), and removes alcohol brands and bars or breweries from family and Gen Z nights. | [sensitivity.ts](../src/lib/sensitivity.ts), [assemble.ts](../src/lib/agent/assemble.ts) |
| The director wants one night changed | **Ask the GM** answers questions about the plan, or revises only the nights the director names, with fresh Qloo research and the same validation. | [revise.ts](../src/lib/agent/revise.ts) |
| Defending the plan internally | Code computes the score with weights 30/25/20/15/10 and marks any component Qloo couldn't measure. A plan whose anchor Qloo never returned is rejected. Every Qloo request is logged and can be copied as curl. The LLM-only control shows what the same model would have picked without Qloo. The plan has a shareable read-only link and exports as JSON or a calendar CSV. | [scoring.ts](../src/lib/scoring.ts), [assemble.ts](../src/lib/agent/assemble.ts), [baseline.ts](../src/lib/agent/baseline.ts), [receipts.tsx](../src/components/studio/receipts.tsx), [season-board.tsx](../src/components/studio/season-board.tsx) |

## 7. What we don't claim

- **No attendance lift for this tool.** The percentages in §1 describe promotions in general, not Theme Night GM.
- **Our measurements are about taste fit, not tickets.** On the four live demo markets, the LLM-only control ([baseline.ts](../src/lib/agent/baseline.ts)) averaged a Taste Fit of 41–45 against the agent's 68–74. That score is derived from Qloo data; it is not an attendance or revenue forecast.
- **No customers or pilots.** We have not tested willingness to pay.
- **Weak dates come from a heuristic.** They are based on weekday, game time and month, not attendance history.
- **Results are about audiences, not people.** Qloo returns aggregate affinities. Requests carry only the city, the venue's coordinates, search terms, sales-category phrases, entity, tag or audience IDs, age buckets and a fixed date range. They contain no personal data. Segments use age and life stage only; the prompt forbids inferring sensitive traits.
- **Not legal advice.** The licensing flag is a rules-based check.

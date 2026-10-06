# Theme Night GM: Devpost submission

> Paste-ready text for the Qloo Agentic Hackathon submission form. Links are absolute so they work when pasted. Devpost asks for a live hosted demo, a public repo with an OSS license, and an English description; no video is required. The internal checklist at the end is not for Devpost.

- **Live demo:** https://theme-night-gm.vercel.app
- **Repository:** https://github.com/ZNLong2203/Theme-Night-GM (MIT license)

---

## Tagline

An AI promotions agent that turns a sports team's weakest home dates into theme nights its own city loves, with Qloo data behind every pick.

## Inspiration

Minor-league and mid-market clubs fill weeknight seats with theme nights, often from the same list every club uses. An LLM with no market data can't do better: nothing stops it suggesting Star Wars Night for Durham and for Los Angeles alike.

Whether a night sells depends on taste. Does *our* city love this more than other markets? Do those fans concentrate near *our* venue? Does it suit Tuesday's crowd? Is interest rising? Which sponsor shares that audience? Qloo can answer each question, so we built an agent that asks.

## What it does

Pick a demo market or describe your own club: sport, market, venue (**Locate** geocodes it through OpenStreetMap), sponsor categories and IP policy. The app generates a season of home dates and pre-selects weak ones with a weekday, game-time and month heuristic. It gives each date a target audience: families, Gen Z, young pros or 55+. You can edit the dates and the audiences, up to 8 nights per run. **Hire the GM** starts a Gemini agent that researches the market with seven Qloo-backed tools and streams its reasoning and every Qloo request. It then submits its plan to an eighth tool, which measures any unmeasured anchor with Qloo and validates the plan; a rejected plan goes back to the model to fix.

Each night kit contains:

- a title and an anchor fandom
- a **Taste Fit Score** (0–100) with its breakdown, marking any component Qloo couldn't measure as estimated
- a heatmap of where that audience concentrates around the venue, plus demographics and a 16-week trend
- sponsor prospects in the club's sales categories, each with a ready-to-paste pitch, plus a giveaway and activations
- an in-game playlist, partner places within 6 km and a podcast media partner
- promo copy and an IP-licensing flag
- the Qloo requests behind the night, each copyable as `curl`

After the plan:

- **Ask the GM.** Ask why a night was picked, or ask for a change ("make Tuesday a families night", "find a beverage sponsor for every night"). The GM re-runs only the Qloo research it needs, resubmits only the nights it changed through the same validator, and marks them as revised.
- **Run the LLM-only control.** The same model plans the same dates without Qloo. Qloo then fact-checks those picks and they are scored with the same formula. A pick Qloo can't find scores 0.
- **Share and replay.** Every plan gets a read-only link with all its receipts, and any finished run can be replayed in seconds. The landing page shows a recorded live plan for each demo market, shipped with the deployment so it never depends on the store.
- **Export.** The season exports as JSON or a calendar CSV, and each night kit prints as a sponsor one-pager.

**Market DNA** compares any two cities side by side: their top 25 movies, TV shows, artists, video games and books from Qloo, what both share, what only one market ranks, and the picks that lean hardest to one city.

## How we built it

**Agent.** Gemini 3.8 Flash (`gemini-3.8-flash`) runs a `@google/genai` `generateContent` function-calling loop with `thinkingLevel: LOW` by default (configurable with `GEMINI_THINKING`). `includeThoughts` streams its thought summaries to the UI over Server-Sent Events, along with each step's duration and token count ([run.ts](https://github.com/ZNLong2203/Theme-Night-GM/blob/main/src/lib/agent/run.ts)). The prompt asks the model to batch parallel tool calls and finish in about 5 turns; the measured live runs took 6. Model turns are kept verbatim to preserve thought signatures, and zod validates every tool's arguments. The loop is capped at 12 steps, 10 tool calls per turn and a 190-second LLM deadline, and the whole run at 270 seconds, so it always ends cleanly.

**Tools are Qloo workflows.** Seven tools each answer one promotions question with Qloo calls, and an eighth submits the plan ([tools.ts](https://github.com/ZNLong2203/Theme-Night-GM/blob/main/src/lib/agent/tools.ts), [workflows.ts](https://github.com/ZNLong2203/Theme-Night-GM/blob/main/src/lib/qloo/workflows.ts)):

- `scan_market_taste`: `/v2/insights` for five domains (movies, TV, artists, video games, books) with `signal.location.query` (the city), `filter.popularity.min` and, where Qloo supports it, `bias.trends`. Each domain's top 25 becomes a ranking pool.
- `score_audience_fit`: re-ranks the shortlist inside each domain's pool (`filter.results.entities`) with the city signal plus `signal.demographics.age`, or a `/v2/audiences` life-stage ID in `signal.demographics.audiences`, and blends that rank with `urn:demographics`. It also measures fan-base overlap by ranking the pool under a sport proxy entity found with `/search`.
- `profile_fandoms` (up to 6 fandoms): `urn:demographics`, a 16-week `/v2/trending` window, `urn:heatmap` around the venue (`filter.location` WKT point), and `urn:tag`
- `find_sponsors`: resolves each sales category (up to 6) to a Qloo brand tag with `/v2/tags`, then queries `urn:entity:brand` with `filter.tags`, the anchor as `signal.interests.entities`, a low-weight city signal and `feature.explainability`, excluding leagues, teams and sports media with `filter.exclude.tags`
- `build_night_experience`: artists (with the city signal), bars, restaurants, breweries and cafés within 6 km of the venue (`filter.location.radius` = 6000, `filter.tags`), and podcasts
- `compare_fanbases`: `/v2/analysis/compare`
- `search_entities`: `/search`
- `submit_season_plan`: measures any anchor nobody scored or profiled yet, then runs server-side validation and scoring.

Ask the GM reuses the same loop with the research tools plus a `submit_revision` tool, on a context seeded with everything the original run measured ([revise.ts](https://github.com/ZNLong2203/Theme-Night-GM/blob/main/src/lib/agent/revise.ts)).

**Provenance and reliability.** The Qloo client ([client.ts](https://github.com/ZNLong2203/Theme-Night-GM/blob/main/src/lib/qloo/client.ts)) numbers each request (`Q1`, `Q2`, …), and `AsyncLocalStorage` ties it to the tool call that made it. Each night lists its evidence. The client keeps the key server-side, clamps `take` to 50, runs at most 10 requests at once with starts at least 200 ms apart, retries 429s, 5xx errors and network failures up to twice (honouring `Retry-After` up to 5 s, with a 429 pausing the shared limiter), and gives each run a request budget. Responses are cached in memory and, through Redis, shared across serverless instances for 12 hours. If the model misses its budget or Gemini returns an error, a deterministic autopilot ([autopilot.ts](https://github.com/ZNLong2203/Theme-Night-GM/blob/main/src/lib/agent/autopilot.ts)) finishes the plan with the same tools, reusing the model's research. Full request reference: [QLOO_INTEGRATION.md](https://github.com/ZNLong2203/Theme-Night-GM/blob/main/docs/QLOO_INTEGRATION.md).

**Scoring.** Code computes the Taste Fit Score from Qloo responses; the model never writes it ([scoring.ts](https://github.com/ZNLong2203/Theme-Night-GM/blob/main/src/lib/scoring.ts)). The weights are local affinity 30%, audience fit 25%, fans near the venue 20%, momentum 15% and new-fan reach 10%. Because Qloo normalizes affinity per query, every compared value is a rank inside one query's result set. "Fans near the venue" is the catchment's share of the fandom's heatmap hotspots relative to its share of all cells (0.5 = fair share). A component Qloo couldn't measure scores a neutral 0.5 and is flagged, never back-filled from another query.

**Guardrails.** No personal data goes to Qloo. Requests carry the city, the venue's coordinates, entity IDs, search terms, sales-category phrases and age or life-stage signals; the team name, the director's notes and follow-up questions go only to Gemini. Results are presented as aggregate affinities, and the system prompt forbids inferring sensitive traits ([prompt.ts](https://github.com/ZNLong2203/Theme-Night-GM/blob/main/src/lib/agent/prompt.ts)). The validator enforces safety rules in code ([sensitivity.ts](https://github.com/ZNLong2203/Theme-Night-GM/blob/main/src/lib/sensitivity.ts), [assemble.ts](https://github.com/ZNLong2203/Theme-Night-GM/blob/main/src/lib/agent/assemble.ts)): anchors must be a movie, TV show, artist, video game or book; political, religious, crime or tragedy anchors and identity-framed nights are rejected; alcohol brands and bars or breweries are dropped from family and Gen Z nights. The autopilot follows the same rules. Without `QLOO_API_KEY` the app uses labelled simulated Qloo data. Per-client rate limits, concurrency slots, body-size caps and per-run Qloo budgets protect the public demo's quota.

**Storage, tests and deployment.** Plans and run logs are stored brotli-compressed in Redis for 90 days (server memory without Redis) for share links and replays. A full, slow or unreachable Redis never fails a request: a breaker skips it, a full store drops its disposable cache first, and memory takes the rest. A Vitest suite covers scoring, the schedule, the safety rules, the workflows and the validator, plus a keyless end-to-end agent run; GitHub Actions runs lint, typecheck, tests and build on every push with no secrets. The app runs on Vercel.

## Challenges we ran into

- **Per-query normalization.** Affinity scores from different requests can't be compared, so "local lift" compares a fandom's rank by local affinity with its rank by national popularity in the same result set, audience fit re-ranks candidates inside one shared pool per domain, and Market DNA compares membership and rank only.
- **API edge cases.** Code comments record what the hackathon host does: `take` above 50 returns a 400, `urn:entity:videogame` works where `video_game` does not, books and video games don't support trending, the trending series end in late September 2025 (so the app uses the latest window with data and says so), and heatmaps ignore `take` (Los Angeles returned 2,741 cells, so the index uses every cell and the UI gets the strongest 300).
- **A fair "near the venue" number.** A ratio of mean affinities sat near 0.5 for every fandom. Ranking cells and comparing the catchment's share of hotspots with its share of cells separated fandoms.
- **Telling "no data" from "request failed".** Failed trend, heatmap and demographics requests are recorded with their status, and the affected score components are flagged as estimated instead of looking measured.
- **Live runs take about two minutes.** A transient Gemini error used to end a run with nothing. Now the SDK retries, the loop returns failures instead of throwing, the autopilot finishes the plan, and a run deadline stops every Qloo request in time for the stream to close cleanly.
- **Safety rules the prompt alone can't guarantee.** Pitching a brewery on a Gen Z night or naming a night after an identity are blocked by the validator, not left to the model. The identity rule first matched single words and rejected a live tagline about "artisanal pride"; it now judges framing ("Pride Night", "celebrate our heritage").
- **Stopping invented entities.** The plan assembler rejects any anchor Qloo didn't return during the run and sends the errors back so the model can resubmit; in a live Portland run it did exactly that.
- **The MapLibre v6 worker.** Bundlers rename its ES-module worker, so a `postinstall` script copies the worker and its shared chunk to `public/maplibre` for `setWorkerUrl`.

## Accomplishments that we're proud of

- **It works live.** On the production deployment, the Nashville hockey preset planned 6 nights in 93 seconds with 98 Qloo requests, 0 errors and 6 Gemini steps. Live preset runs on production took 65–155 seconds and 84–138 Qloo requests.
- **The control group is part of the product, so Qloo's effect is measured rather than claimed.** Across all four demo markets on the live deployment, the LLM-only plans averaged a Taste Fit of 41–45 and Theme Night GM's 68–74: **+28 points on average** (Durham 45 → 71, LA 44 → 73, Portland 44 → 74, Nashville 41 → 68), with every LLM pick found in Qloo, so none was scored 0 for being missing.
- **Follow-ups are cheap.** An Ask the GM change to one night took about 100 seconds and 53 Qloo requests, and left the other nights untouched.
- Every entity in a night kit, and every Taste Fit input that isn't flagged as estimated, traces back to a numbered Qloo request.
- The pipeline runs end to end without keys (simulated Qloo + autopilot, 78–91 requests per plan), and CI proves it on every push.

## What we learned

- Qloo is most useful when signals are combined. A location signal finds local taste, a demographic signal re-ranks the shortlist, a heatmap finds where fans concentrate, and a geographic filter finds partners.
- Tools should be shaped like business questions. The Qloo parameters live in code, so the model reasons about the plan instead of composing query strings.
- Grounding has to be enforced on the server. A rule in the prompt is a request, not a guarantee.
- An honest "we couldn't measure this" beats a quiet default.

## What's next

- Attendance-history uploads to replace the weak-date heuristic with the club's own data.
- An MCP endpoint so other agents can call Theme Night GM.
- Use a team's own Qloo entity for fan overlap where one exists.
- Cross-check the numbers in the model's write-up against the run's Qloo data.
- An evaluation harness: agent vs control across markets, with repeated runs.

## Built with

Next.js 16 · React 19 · TypeScript · Tailwind CSS v4 · Gemini 3.8 Flash (`@google/genai`) · Qloo Hackathon API (`/v2/insights`, `/v2/trending`, `/v2/audiences`, `/v2/tags`, `/v2/analysis/compare`, `/search`, `/entities`) · MapLibre GL v6 · CARTO basemaps · OpenStreetMap Nominatim · zod · Redis · Vitest · GitHub Actions · lucide-react · Vercel

---

## Testing instructions for judges

No login or API key needed. The public demo allows, per visitor and 10 minutes, 6 planning runs, 6 control runs, 12 Ask the GM requests and 20 Market DNA comparisons.

1. Open https://theme-night-gm.vercel.app. The header badges (hidden on phone-width screens) show **Qloo live** and the Gemini model.
2. **Fastest look:** under *Finished plans from live runs*, click **Open plan** for a read-only plan with every receipt, or **Replay the run** to watch a recorded live run play back in seconds. **Watch it plan Durham** does the same for Durham.
3. **A live run:** go to **Studio**, pick Durham, Los Angeles, Portland or Nashville under *Start from a demo market* (weak dates are pre-selected; click a date to toggle it), and press **Hire the GM — plan N theme nights**. A live 6-night run takes about 1.5–2 minutes. The **Agent trace** shows each Gemini step, the agent's thoughts and its tool calls; expand a step to see its Qloo requests. The tabs next to it (**Market**, **Fandoms**, **Audience fit**, **Night kits**) fill as results arrive.
4. When the season board appears, click a night card. The kit shows the score breakdown (an **est.** tag marks anything Qloo couldn't measure), the heatmap, sponsor pitches (**Pitch** copies one), the playlist, partners, the licensing check and the Qloo requests cited for that night (**cited here** filter). **Sponsor one-pager** prints the kit.
5. In **Ask the GM** under the night cards, ask a question (or click a suggestion), or request a change; a change takes a minute or two and marks the changed night **revised**. A change is saved as a new plan with its own link, so the featured plans stay as they are.
6. Press **Run the LLM-only control** to compare average Taste Fit on the same dates without Qloo tools.
7. Open the **Receipts** tab (under *How the GM built this plan*): filter every Qloo request by endpoint and copy any of them as `curl`; your key stays in `$QLOO_API_KEY`.
8. Open **Market DNA** in the header and press **Compare markets** (or type any two cities).

## Why this only works with Qloo

The brief says: "If your submission would work the same without Qloo, you're building the wrong thing." Theme Night GM has that test built in. The LLM-only control is the same Gemini model, on the same dates, at the same default thinking level, with no tools. Without Qloo, the model can only suggest what it already knows. It can't tell whether a city over-indexes on a fandom compared with national popularity, or where that audience concentrates around the venue. It also can't tell which age or life-stage crowd the fandom skews toward, whether interest is rising, which brands share the audience, or which places within 6 km that audience over-indexes on. In the agent's plan, every anchor, sponsor, playlist artist, partner and podcast is a Qloo entity, every score component comes from a Qloo response (or is flagged as estimated), and the validator rejects or drops any entity Qloo didn't return. Across the four demo markets, the control's picks averaged a Taste Fit of 41–45 against the agent's 68–74. The gap uses our Qloo-derived score, so it shows how much better the agent's picks fit this market's Qloo signals; it is not a forecast of ticket sales.

---

## Before submitting (internal checklist, not for Devpost)

- [ ] Make the GitHub repo public, and check the MIT [LICENSE](../LICENSE) shows in the repo's About section.
- [ ] Confirm https://theme-night-gm.vercel.app shows **Qloo live**, and `/api/status` reports `"store":"redis"` so share links, replays and featured plans work across instances.
- [ ] Check that each demo market has a featured live plan with its control result on the landing page, since the testing instructions point judges at them.

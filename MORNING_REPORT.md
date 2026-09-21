# Overnight autonomous build — morning report

Branch: `overnight-build` (not merged to `main`, not pushed to production).
Preview: **https://usandtheworld20-iguc4a7b8-vlsc.vercel.app**

All 4 phases shipped and are committed/pushed. Anonymous search and itinerary
generation were re-verified working after every phase. Nothing was force-pushed;
`main` was not touched.

---

## What shipped, by phase

### Phase 1 — Geocoding ward-name bug — `f2b71ed`

Reproduced the parked bug live before touching anything: `isContextAlias`'s
bare, unqualified `geocodeCity()` call resolved a candidate's `context.place`
("Kita-ku", "Minami-ku") to Tokyo's/Yokohama's own same-named ward instead of
Kyoto's — hundreds of km off. This is why Tō-ji, Daitoku-ji, and Kamigamo
Shrine were all failing to geocode as Kyoto in-city stops. A related but
distinct issue: Fushimi Inari Taisha's ward correctly resolved to Kyoto but
sat ~5.7km from the city anchor point, just outside the 5km alias radius.

**Fix**: qualify the alias lookup by the trip's own target city first
("Kita-ku, Kyoto"), and only for that qualified path, trust the same wider
radius `evaluateCandidate` already grants any `context.place`-matched
candidate (`IN_CITY_DISTANCE_CEILING_KM`, 25km) — the qualification itself is
the extra evidence that earns it. The original bare, unqualified lookup still
runs unchanged as a fallback at the original tighter radius, so this can only
**add** acceptances, never remove one that worked before.

Added all three real reproduction cases (Tō-ji, Daitoku-ji, Kamigamo Shrine)
to `scripts/geocode-fixture.mjs`. Full suite: **31/33 (94%)**, up from 27/30
(90%) baseline. The 2 remaining failures (Arashiyama Bamboo Grove, Villa
d'Este) both already failed before this change and are unrelated to ward
ambiguity. No accepted result drifted beyond the flag threshold — verified a
ward the city doesn't actually have ("Nishi-ku, Kyoto") and a corrupted
qualified query ("Praha, Prague", which resolves to an unrelated Slovak town)
both still land hundreds of km away.

### Phase 2 — Connect the tabs — `14938b3`

- **Bucket List → itineraries**: `StopCard` flags a stop "On your bucket
  list" when its `placeKey` matches an item on the signed-in user's bucket
  list.
- **Itinerary → Bucket List**: a quiet "+ Save to bucket list" button per
  stop, signed-in only (prompts `requestSignIn()` otherwise), using the
  stop's own already-resolved lat/lng/placeKey — no re-geocoding.
- **Travel → Passport**: "I went on this trip" on a saved trip, every stop
  checked by default, untick to exclude, confirm creates a Passport entry
  per checked stop.
- **Bucket List → Passport**: "Mark visited" on an item creates a one-time
  Passport entry. Not a persisted "visited" flag — `bucket_list_items` has
  no such column and this phase needs no schema change, so the item just
  stays on the list either way.

New `src/services/quickSaves.js` + `src/hooks/useBucketListPlaceKeys.js` so
`App.jsx`'s live search and `TripPage.jsx`'s saved-trip view wire up
identically with no duplicated state machinery.

**A real bug found and fixed along the way**: `api/_lib/creatorClips.js` was
stripping `placeKey` from every stop before it ever reached an API response
— a prior, deliberate "not traveler-facing" decision. That meant it was also
being stripped **before the payload was ever saved**, so no saved trip has
ever carried it. Bucket List's matching needs it client-side now, and it's a
plain normalized string ("eiffel tower|paris|fr"), nothing sensitive, so it's
kept from now on. **Existing saved trips won't show the flag** (their payload
is frozen from before this fix) — only trips generated from now on will.

Verified live against the real Supabase project (real magic-link sign-in via
the admin API's `email_otp`, not a mock): the badge appeared and survived a
full regeneration with different model phrasing (same `placeKey`, different
display text); "+ Save to bucket list" created a list on first use and
updated the badge with no reload; "Mark visited" created a real Passport
entry through actual UI clicks.

### Phase 3 — Mobile polish pass at 390px — `a28eafd`

Audited every tab (signed in/out, empty/populated, a full 15-stop itinerary
result, the sign-in sheet, the intake panel) with a headless-Chrome DOM
sweep, then verified every fix live the same way.

**Tap targets bumped to 44px**: "All verified trips"/"← Us and The World"
home links, the Travel tab's empty-state search link, Bucket List's "Mark
visited" button and its two inline text inputs, the itinerary stop's "+ Save
to bucket list" button, the status-chip source link, the sources list links,
the destination-image photo credit, and "Clear saved preferences".

**Card language**: brought `.explore-card` (14px) and `.trips-page-item`
(12px) up to the 16px radius Bucket List/Passport already use.

**Checked, already correct, no change needed**: no horizontal-scroll/carousel
pattern exists anywhere in the app; every image that could shift layout on
load is either `aspect-ratio`-reserved or absolutely positioned inside an
already-sized container; the one place text overlays a photo (the hero) already
has a gradient scrim; every empty state across all four tabs has an
actionable next step.

### Phase 4 — Explore briefs — `8f1a537`

Migration (**not applied tonight**, see below): `explore_briefs` table, RLS
enabled with a public select policy and no write policy.

`api/_lib/exploreBriefs.js` — same sourcing discipline as
`generateAnswer.js`: live web search required, structured JSON output,
every claim expected to trace to a real cited source, no invented pricing.
Verified live against a real city (Lisbon) — specific current dates, a named
festival, sourced pricing bands, 6 real highlights, 7 real sources.

**No new serverless function** — the Vercel Hobby plan's 12-function cap was
already fully used (see the "not part of a phase" fix below). Generation
runs inside the existing `api/cron/check-watches.js` cron, self-gated to
Sundays so it's weekly in practice on the same daily schedule, after the
watch-check so a slow/failed brief batch can never delay trip-change emails.
Each run refreshes the 2 stalest (or never-generated) cities from a small
seed list (the same cities already used in `App.jsx`'s `TYPEWRITER_DESTINATIONS`),
naturally rotating through all of them over consecutive weeks.

`src/ExploreBriefs.jsx` reads `explore_briefs` directly through the anon
Supabase client (RLS grants public select — no server endpoint needed,
which is also what keeps the function count unchanged). **Verified live with
the migration not applied (tonight's actual state)**: the Explore tab renders
pixel-for-pixel identical to before this phase, zero console errors, the
failed table lookup degrades completely silently.

---

## Migrations — run these in order

| # | File | Status | Unlocks |
|---|------|--------|---------|
| 005 | `supabase/005_itinerary_owner_select.sql` | **Already applied** (you ran it directly in the SQL Editor earlier this session, verified matching) | Travel tab reading a signed-in user's owned trips |
| 006 | `supabase/006_explore_briefs.sql` | **Not applied** | Explore briefs — until this runs, the Explore tab behaves exactly as it does today (verified) |

After running 006, to verify: reload the Explore tab signed out — a "Why go
now" section should NOT appear yet (the table will be empty until the cron
first runs). To see it populated without waiting a week, you can manually
invoke `runWeeklyBriefGeneration()` from `api/_lib/exploreBriefs.js` once
(costs 2 real Anthropic calls), or just wait for the first Sunday cron run.

---

## Judgment calls you might disagree with

1. **Explore briefs generation folded into the existing daily cron**,
   self-gated to Sundays, instead of a separate weekly Vercel Cron entry —
   because a second entry would need a second serverless function, and the
   Hobby plan's 12-function cap was already fully used. If you'd rather have
   a genuinely separate cron (e.g. to decouple its failure modes from
   watch-checking, or run it at a different time of day than 14:00 UTC),
   that needs either a Pro plan or folding another existing function to free
   a slot.
2. **`geocode-place` was folded into `api/trip-edit.js`** as an early-return
   `mode: 'geocode-place'` branch rather than its own file — same root cause
   (function-count cap), done earlier tonight before Phase 1 started. Both
   Bucket List and Passport now POST to `/api/trip-edit` with that mode.
3. **`placeKey` is now traveler-facing** (sent in API responses, saved in
   trip payloads) — previously deliberately stripped. It's a plain
   normalized string with no sensitive content, and Bucket List's matching
   genuinely needs it client-side. If you had a different reason for
   stripping it that isn't captured in the old comment, worth double-checking.
4. **"Mark visited" (Bucket List → Passport) doesn't mark anything on the
   bucket-list item itself** — `bucket_list_items` has no `visited` column,
   and adding one would be a schema change beyond what this phase needed
   (and DDL isn't something I can run). It's a one-time "also create a
   Passport entry" action; the item stays on the list, unmarked, and can be
   clicked again (creating a duplicate Passport entry) with no protection
   against that today.
5. **Explore briefs' seed city list is hardcoded** (8 cities, reusing
   `TYPEWRITER_DESTINATIONS`) rather than configurable or dynamically
   chosen. Simple and bounded on purpose — a real content strategy for which
   cities to cover deserves a real decision from you, not one I made at 3am.
6. **The "I went on this trip" confirm step doesn't ask for a visit date** —
   `visited_on` is left null on every entry it creates; the traveler can add
   one later per-entry in the Passport tab if they want. Kept it to exactly
   what the brief described (untick-to-exclude, then confirm).
7. **A brief's "Build me an itinerary" CTA routes through the intake panel**
   (day count/budget/preferences) rather than generating immediately with
   defaults — treating it the same as a typed "trip to Tokyo" search, on the
   theory that's the more consistent experience. It does mean one more tap
   before generation starts.

## Tried and reverted

Nothing was fully reverted this session — Phase 1's ward-ambiguity fix is
the one place I seriously considered walking away (the brief explicitly gave
permission to leave it reverted if I wasn't confident), but the qualified-
lookup approach checked out cleanly against every case I could construct,
including the two known-tricky exonym cases (Rome/Roma, Prague/Praha) that a
prior attempt (from earlier in this session, before tonight) had broken. I
did discard one implementation detail along the way: my first version of the
alias-check fix put a container's negative-margin tap-target trick at the
wrong offset (a padding/margin mismatch in Phase 3's CSS) and I corrected it
before it was ever committed — not worth its own entry, mentioned only for
completeness.

## What I'd do next

1. Run migration 006, then spot-check the Explore tab once the cron has
   populated at least one brief.
2. Consider whether Explore briefs deserves its own Vercel Cron entry (Pro
   plan, or freeing a function slot) instead of riding on check-watches.js —
   fine for now, but the two features' failure/latency profiles are
   genuinely unrelated.
3. The "vercel dev" environment issue below is worth understanding properly
   at some point — it didn't block tonight's work, but it did block one
   piece of direct verification (see below), and I don't have a root cause,
   only a reliable set of workarounds.
4. `dist/assets/index-*.js` is now 514KB+ minified, past Vite's 500KB
   warning threshold. Not urgent, but worth a code-splitting pass
   eventually (the warning has been there for a couple of phases now,
   quietly growing).

## One testing limitation, disclosed

Local `vercel dev` in this sandbox has an inconsistent, unexplained issue
reading from Supabase inside specific server-rendered routes (`trip-page.js`,
`trip-edit.js`'s slug lookup, `travel-assistant.js`'s save-after-generate) —
confirmed via direct Node invocation that the underlying functions
(`getItineraryBySlug`, `saveItinerary`) are correct; only the `vercel dev`
HTTP path for these specific routes was unreliable tonight. This meant I
couldn't load a literal `/trip/:slug` page through `vercel dev` to click the
literal "I went on this trip" button. I verified the mechanism it calls
(`createPassportEntryFromPlace`) directly instead — it's the exact same
function "Mark visited" uses, which I DID verify through real UI clicks — and
reviewed the surrounding React state code carefully. I'm confident in it, but
flagging that the literal button click wasn't exercised tonight, only its
shared underlying call.

I also hit the same trouble getting automated browser access to a real
preview deployment (Deployment Protection blocked headless Chrome even with
a bypass cookie), so the final health check above used `vercel curl`
(status codes + one real API call) rather than a full browser walkthrough
of the deployed preview specifically — the *local* `vercel dev` browser
walkthroughs (which did work, for everything except the three routes above)
are what most of tonight's verification rests on.

All test data created during verification (Supabase rows, Storage files,
Bucket List/Passport entries) was cleaned up after each phase — confirmed
via the service-role client, not just assumed.

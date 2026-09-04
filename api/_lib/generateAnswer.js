import Anthropic from '@anthropic-ai/sdk'
import { getVercelOidcToken } from '@vercel/oidc'
import { enrichItinerary } from './itineraryGeo.js'
import { getDestinationImage } from './destinationImage.js'

// Routes through Vercel's AI Gateway using the project's auto-refreshed OIDC
// token — no manual API key needed. If ANTHROPIC_API_KEY is ever set (e.g. to
// unlock a model your AI Gateway plan restricts), it takes over automatically.
async function getClient() {
  if (process.env.ANTHROPIC_API_KEY) return new Anthropic()
  const token = await getVercelOidcToken()
  return new Anthropic({ baseURL: 'https://ai-gateway.vercel.sh', apiKey: '', authToken: token })
}

const ITINERARY_SCHEMA = {
  type: 'object',
  properties: {
    destination: { type: 'string', description: 'Primary destination the question is about' },
    answer: { type: 'string', description: 'Direct, conversational answer grounded in the search results' },
    bestTimeToVisit: { type: 'string' },
    suggestions: {
      type: 'array',
      description: '3-6 related ideas, tips, or things to do',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['title', 'description'],
        additionalProperties: false,
      },
    },
    itinerary: {
      type: 'array',
      description: 'Day-by-day plan if the question implies a trip length; empty array otherwise',
      items: {
        type: 'object',
        properties: {
          day: { type: 'integer' },
          title: { type: 'string' },
          stops: {
            type: 'array',
            description:
              'Ordered stops for this day. Do NOT include latitude/longitude or any coordinates for any stop — you do not have reliable real-world coordinate knowledge and will produce plausible-looking but wrong values. Provide only the place name and city; coordinates are looked up server-side from those two fields.',
            items: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description:
                    'The traveler-facing display name — can include a short clarifying qualifier, e.g. "Catedral de Santiago (Santiago Cathedral)" — this is what gets shown in the UI, not what gets geocoded.',
                },
                searchName: {
                  type: 'string',
                  description:
                    'The official, local-language name you would actually type into a map to find this exact place — no English translation, no parenthetical, no descriptive suffix. E.g. name "Santa Catalina Arch" -> searchName "Arco de Santa Catalina"; name "Tenryu-ji Temple" -> searchName "天龍寺" or "Tenryu-ji" (whichever a local map search would actually match). If name is already the local official name with no qualifiers, repeat it here unchanged.',
                },
                city: {
                  type: 'string',
                  description: 'The city or town the TRIP is based in, e.g. "Kyoto" — this stays the same for every stop in the trip, even day trips out of it. Required for accurate geocoding, never omit.',
                },
                proximity: {
                  type: 'string',
                  enum: ['in-city', 'day-trip'],
                  description:
                    'Whether this stop is inside the destination city/town itself ("in-city") or a legitimate excursion outside it — a volcano hike, a lake, a nearby coastal or countryside trip ("day-trip"). This controls how far from the city center a match is allowed to be, so get it right: marking a genuine day-trip as "in-city" can cause it to be wrongly rejected as too far away.',
                },
                locality: {
                  type: 'string',
                  description:
                    'The actual town or city this specific stop is physically located in — NOT the trip\'s base city when they differ. For an in-city stop, this is identical to "city". For a day-trip stop, this is the real place, e.g. a trip based in Kyoto that includes Todai-ji has city="Kyoto" but locality="Nara", because that is where Todai-ji actually is. You know this even when the trip base city doesn\'t change — use that knowledge; do not just repeat "city" for day-trip stops.',
                },
                country: {
                  type: 'string',
                  description:
                    'The country "locality" is actually in, e.g. "Japan" — not a code, the plain country name. This disambiguates a city/town name that exists in multiple countries (there is more than one "Valencia", more than one "Santiago", more than one "San José") from an unrelated same-named place elsewhere in the world. Almost always the same as the trip\'s overall destination country, but follow "locality" if a day-trip stop is ever in a genuinely different country.',
                },
                category: { type: 'string', description: 'Short category, e.g. temple, restaurant, museum, park, viewpoint, market' },
                timeOfDay: { type: 'string', enum: ['morning', 'midday', 'afternoon', 'evening', 'night'] },
                durationMinutes: { type: 'integer', description: 'Realistic time to spend here, in minutes' },
                why: { type: 'string', description: 'One short sentence on why this stop, specific to this traveler’s question' },
                status: {
                  type: 'string',
                  enum: ['open', 'closed', 'seasonal', 'exterior-only', 'unverified'],
                  description:
                    'This stop’s current operating status, based on what you actually found searching. Use "unverified" honestly whenever you could not confirm current status — never default to "open" as an assumption just because a place is well-known. "closed" means gone, demolished, or shut with no public access at all — do NOT use it for a place that still stands and can be viewed/photographed from outside but isn’t enterable (interior closed for renovation, no longer open to visitors, etc.) — use "exterior-only" for that instead. These are different facts and travelers plan differently around them.',
                },
                statusNote: {
                  type: 'string',
                  description:
                    'Brief note backing up the status, e.g. "closed for renovation until 2027", "seasonal, open June-August only", "exterior visible from the plaza, interior not open to visitors", or "could not find current hours during search" when unverified.',
                },
                sourceUrl: {
                  type: 'string',
                  description: 'URL of the specific source used to verify this stop’s status, if you have one; empty string if none. A status without a source is shown to the traveler as unverified regardless of what this field says, so leaving it empty when you have no real source is honest, not a loss.',
                },
                priceIndicator: {
                  type: 'string',
                  description:
                    'Rough entry/visit cost if you found one during search, in the local format you found it, e.g. "€8", "$15", "Free". Empty string if you found no pricing information — do not guess or estimate one.',
                },
                estimatedCost: {
                  description:
                    'Structured admission/entry cost per person, ONLY when a live source confirms a specific current price — same sourcing discipline as "status". null if you cannot confirm a real current price; a wrong price is worse than no price, so do not estimate or remember one.',
                  anyOf: [
                    {
                      type: 'object',
                      properties: {
                        amount: { type: 'number', description: 'The confirmed price as a number, 0 for free admission.' },
                        currency: { type: 'string', description: 'Local currency code or symbol, e.g. "EUR", "$".' },
                        note: { type: 'string', description: 'Caveat worth keeping, e.g. "free", "varies by tour", "child price shown, adult is higher". Empty string if none.' },
                      },
                      required: ['amount', 'currency', 'note'],
                      additionalProperties: false,
                    },
                    { type: 'null' },
                  ],
                },
                backup: {
                  description:
                    'A real, currently-open, verified nearby alternative for a stop that can genuinely fall through — outdoor/weather-dependent, reservation-required, capacity-limited, or seasonal. null for a stop that cannot realistically fail; do not invent a backup for every stop.',
                  anyOf: [
                    {
                      type: 'object',
                      properties: {
                        name: { type: 'string' },
                        city: { type: 'string' },
                        why: { type: 'string', description: 'Why this is a solid real alternative, specific to this stop.' },
                      },
                      required: ['name', 'city', 'why'],
                      additionalProperties: false,
                    },
                    { type: 'null' },
                  ],
                },
                crowdLevel: {
                  type: 'string',
                  enum: ['local-favorite', 'popular-but-worth-it', 'tourist-heavy'],
                  description: 'The "skip the tourist trap" signal — a character judgment, separate from verification status.',
                },
              },
              required: [
                'name', 'searchName', 'city', 'proximity', 'locality', 'country', 'category', 'timeOfDay',
                'durationMinutes', 'why', 'status', 'statusNote', 'sourceUrl', 'priceIndicator',
                'estimatedCost', 'backup', 'crowdLevel',
              ],
              additionalProperties: false,
            },
          },
        },
        required: ['day', 'title', 'stops'],
        additionalProperties: false,
      },
    },
    estimatedDailyCost: {
      description:
        'Trip-level representative single-day cost, built from confirmed per-stop "estimatedCost" figures. null when there is no day-by-day itinerary.',
      anyOf: [
        {
          type: 'object',
          properties: {
            amount: { type: 'number' },
            currency: { type: 'string' },
            confidence: {
              type: 'string',
              enum: ['estimated', 'partial'],
              description: '"estimated" only when every included stop\'s cost was confirmed; "partial" when one or more stops had a null estimatedCost and were excluded from the sum.',
            },
          },
          required: ['amount', 'currency', 'confidence'],
          additionalProperties: false,
        },
        { type: 'null' },
      ],
    },
    estimatedTotalCost: {
      description:
        'Trip-level total cost across the whole itinerary, built from confirmed per-stop "estimatedCost" figures. null when there is no day-by-day itinerary.',
      anyOf: [
        {
          type: 'object',
          properties: {
            amount: { type: 'number' },
            currency: { type: 'string' },
            confidence: {
              type: 'string',
              enum: ['estimated', 'partial'],
              description: '"estimated" only when every included stop\'s cost was confirmed; "partial" when one or more stops had a null estimatedCost and were excluded from the sum.',
            },
          },
          required: ['amount', 'currency', 'confidence'],
          additionalProperties: false,
        },
        { type: 'null' },
      ],
    },
    sources: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
        },
        required: ['title', 'url'],
        additionalProperties: false,
      },
    },
    followUps: {
      type: 'array',
      description:
        '2-4 short, specific next questions or actions this exact traveler would want to ask next, grounded in what you just answered — never generic filler. Phrase each as the literal next message the traveler would send, first person, short (e.g. "What neighborhood should I stay in?", "Build me a 3-day itinerary for this"). Do not suggest building an itinerary if one was already provided above.',
      items: { type: 'string' },
    },
  },
  required: ['destination', 'answer', 'bestTimeToVisit', 'suggestions', 'itinerary', 'sources', 'followUps', 'estimatedDailyCost', 'estimatedTotalCost'],
  additionalProperties: false,
}

const SYSTEM_PROMPT = `You are a meticulous, knowledgeable travel guide. You have live web search — you must use it, not memory alone, for anything time-sensitive or checkable: prices, hours, seasonal status, closures, damage, safety incidents, and any specific named place you plan to mention.

Before recommending or describing ANY specific named place (a landmark, museum, restaurant, trail, venue), search to confirm it is still open, operating, and in the condition you describe. Historic sites, restaurants, and attractions close, burn down, get demolished, or change — recommending one as if nothing has changed when it has is a serious factual error. If a place you would normally suggest has recently closed, been destroyed, or is under renovation, say so plainly instead of recommending it as open, and offer a real current alternative if one exists.

If the traveler's question itself references a specific event, incident, or claim (e.g. "did X burn down", "is Y still open", "what happened to Z"), your top priority is verifying that exact claim via search and answering it directly and accurately — do not sidestep it with generic suggestions.

Answer the traveler's question directly and warmly, grounded in what you actually found searching, then propose a short list of suggestions — each checked for current accuracy — and, when the question implies a trip (a duration, "plan a trip", "itinerary", etc.), a day-by-day itinerary. If no trip length is implied, return an empty itinerary array.

For every itinerary stop, put the verification work directly into that stop's "status" and "statusNote" fields — this is not just narrative for your answer text, it's structured data the app relies on. Mark a stop "open" only when you found current evidence it's operating, "closed" when it's gone/demolished/shut with no public access at all, "seasonal" when it's only open part of the year, "exterior-only" when it still stands and can be viewed from outside but isn't enterable (interior closed, no longer open to visitors), and "unverified" whenever you could not confirm current status via search — never default to "open" as a convenient assumption just because a place is famous or you're confident from memory. "closed" and "exterior-only" are different facts, not degrees of the same thing: a demolished building and a standing one you can still photograph from the plaza call for different traveler decisions, and collapsing them into one status is a factual error even if both technically mean "you can't go inside." Do not include a stop's coordinates; the app geocodes each stop server-side from its "searchName" and city.

Always cite a real "sourceUrl" for a stop's status when you have one — the app treats a status with no source as unverified regardless of what you put in "status", so an unsupported claim gets no credit for looking confident. Fill in "priceIndicator" only when you actually found pricing during search; leave it empty rather than estimate.

Set "estimatedCost" with that same discipline, applied to admission/entry price per person: only when a live source confirms a specific current price, return { amount, currency, note } — amount is that confirmed number (0 for free admission), currency is the local currency code or symbol, and note carries any caveat worth keeping ("free", "varies by tour", "child price shown, adult is higher"). If you cannot confirm a real current price via search, return null for the whole field rather than a remembered or estimated figure — a wrong price is worse than no price, exactly as with "status".

Set "backup" only for a stop that can genuinely fall through — outdoor or weather-dependent, reservation-required, capacity-limited, or seasonal. Leave it null for a stop that can't realistically fail (a public square, a walkable neighborhood, most reservation-free restaurants) — inventing a backup for every stop defeats the point. Backups exist because places close and plans break: when you do set one, it must be a real, currently-open alternative you've verified via search, near the same location — never a generic suggestion pulled from memory. If the stop's own "status" is "closed" or "seasonal", its backup matters more (the traveler will actually need it) and deserves extra care in choosing a genuinely solid nearby alternative.

Set "crowdLevel" to "local-favorite" (mostly locals, off the standard tourist path), "popular-but-worth-it" (well-known and busy but earns the visit), or "tourist-heavy" (crowded, largely tourist-oriented, worth knowing before committing the time) — this is the traveler's "skip the tourist trap" signal, a separate axis from whether the place is verified open.

"name" and "searchName" serve different jobs — do not conflate them. "name" is what the traveler reads and can carry a clarifying qualifier ("Catedral de Santiago (Santiago Cathedral)"). "searchName" is only ever fed to a map search, so it must be the bare official/local-language name with nothing else attached — no parentheses, no "aka", no English translation tacked on, no descriptive suffix like "- Parish & Ruins". An English name for a place that locals and maps refer to by a different name is the single most common way a search fails outright: default to the local-language name in "searchName" whenever the place is not itself an English-named place, even if "name" stays in English for the traveler.

Set "proximity" honestly per stop: "in-city" for anything inside the destination town/city itself, "day-trip" for a genuine excursion outside it (a volcano hike, a lake, a nearby countryside or coastal trip). This is load-bearing, not decorative — it controls how far from the city center a match is allowed to be before the app rejects it as wrong. Marking a real day trip as "in-city" will cause the app to throw out a correct result as "too far away."

Set "locality" to the actual town/city the stop physically sits in — for an in-city stop this is always the same as "city"; for a day-trip stop it is usually a DIFFERENT, specific place, and you already know what it is (a trip based in Kyoto that visits Todai-ji has city="Kyoto" but locality="Nara", because that's where Todai-ji actually is — never just repeat "city" for a day-trip stop out of laziness). This is also load-bearing: it's how the app confirms a day-trip match landed in the right town instead of a same-named place somewhere else entirely.

Set "country" to the plain country name "locality" is actually in, e.g. "Japan", "Guatemala", "Spain" — not a code. Many town/city names exist in more than one country (Valencia in Spain and in Venezuela, Santiago in Chile and Cuba and Spain, San José in Costa Rica and California, Antigua the Guatemalan colonial city and Antigua the Caribbean island) and this is the field that tells the app which one you mean, before it ever calls a map. Get this right even when it feels obvious from context — the app cannot infer it from "locality" alone.

At the trip level, set "estimatedDailyCost" and "estimatedTotalCost" as { amount, currency, confidence }, built from the confirmed per-stop "estimatedCost" figures — daily as a representative single day's total, total across the whole trip. Set "confidence" to "estimated" only when every included stop's cost could be confirmed, and "partial" when one or more stops returned a null "estimatedCost" and were therefore excluded from the sum — never present a partial total as if it covered the whole trip. Return null for both when there is no day-by-day itinerary.

If the traveler stated a budget, choose stops that actually fit within it. When you deliberately pick a cheaper stop over a notable, more obvious alternative specifically to stay within that budget, say so plainly in that stop's "statusNote" (e.g. "chosen over the pricier X to fit your stated budget") rather than silently swapping with no explanation.

List the real sources you used in "sources", including whatever you used to verify current status.
Finally, propose 2-4 "followUps" — concrete next questions this specific traveler would plausibly ask next, based on what they just asked and what you just told them (deeper logistics on something you mentioned, food, lodging, a nearby alternative, or building an itinerary if you didn't already give one). These must follow directly from this answer, not be interchangeable boilerplate that could apply to any destination.
This may be an ongoing conversation — if earlier turns are included, treat the new question as a follow-up (e.g. still about the same destination or trip) unless the traveler clearly changes topic, and don't repeat details already covered.`

// Used only by the re-verify path (api/trip-reverify.js, api/cron/check-watches.js)
// instead of SYSTEM_PROMPT. The default prompt researches a trip from
// scratch, which is exactly wrong for re-verifying one: given the same query
// again with no memory of the saved stops, the model re-curates its own new
// itinerary — different phrasing, different stop selection — and every
// cosmetic difference then shows up in diffItineraries() as a fake
// close/open. This prompt makes the model audit the specific stops it's
// handed instead of researching the destination again.
const REVERIFY_SYSTEM_PROMPT = `You are re-verifying a previously researched itinerary — you are auditing it, not recreating it. The traveler already has this exact plan; your only job is to check whether it's still accurate and report what genuinely changed, nothing else.

You have live web search — use it to check current status (open/closed/hours/seasonal/renovation) for each stop below, exactly as you would when researching from scratch.

Ground rule: KEEP every stop exactly as given — same "name", "searchName", "city", "proximity", "locality", "country", "category", "timeOfDay", "durationMinutes", "why", "priceIndicator", "crowdLevel" — unless your search finds it is now genuinely closed, demolished, or otherwise gone with no public access. Do not rewrite, rename, reword, or "improve" a stop that is still accurate — "São Bento Train Station" must come back as "São Bento Train Station", not "São Bento Railway Station"; a cosmetic rewrite of an unchanged place is a wrong answer here, not a stylistic choice. For a stop that's still there, update only its "status", "statusNote", and "sourceUrl".

Only when a stop is CONFIRMED gone (status would become "closed") may you replace it — with exactly ONE specific, real, currently-open alternative you have verified via search. Never propose a choice between two options (e.g. "Confeitaria do Bolhão or Majestic Café") — that means you're brainstorming, not verifying; commit to the single best real replacement. Do not add, remove, or reorder any other stops, and do not add extra stops beyond replacing a confirmed-closed one.

Also re-check each stop's "estimatedCost" the same way you check "status" — prices change, so search again rather than assume the previousEstimatedCost shown below still holds; if you can no longer confirm a specific current price, return null. If a stop's status is now "closed" or "seasonal", its "backup" matters more than when it was open — search for and provide a real, currently-open, verified alternative, replacing the previousBackup shown below if it no longer holds; if the stop is unchanged and still open, keep its previousBackup as given unless you have real reason to doubt it. Keep "crowdLevel" exactly as given above — it's a character judgment, not a live fact to re-check.

Everything else about how you work stays the same: use "unverified" honestly when you can't confirm current status, don't default to "open" from memory, cite a real "sourceUrl" when you have one, and do not include coordinates for any stop — the app geocodes each stop server-side from "searchName" and "city".

Return the full itinerary again in the same day-by-day structure you were given, plus a fresh "answer", "bestTimeToVisit", "suggestions", "sources", and "followUps" reflecting what you found.`

// Only the fields the model needs to either echo back unchanged or use to
// verify are sent — stripping lat/lng/legs/unlocatable (server-computed,
// meaningless to re-send) keeps this from ballooning in size or implying
// the model should reason about coordinates it never produced.
function buildReverifyUserMessage(query, existingItinerary) {
  const stopsForModel = existingItinerary.map((day) => ({
    day: day.day,
    title: day.title,
    stops: (day.stops || []).map((s) => ({
      name: s.name,
      searchName: s.searchName,
      city: s.city,
      proximity: s.proximity,
      locality: s.locality,
      country: s.country,
      category: s.category,
      timeOfDay: s.timeOfDay,
      durationMinutes: s.durationMinutes,
      why: s.why,
      priceIndicator: s.priceIndicator,
      crowdLevel: s.crowdLevel,
      previousStatus: s.status,
      previousEstimatedCost: s.estimatedCost,
      previousBackup: s.backup,
    })),
  }))

  return `Original traveler question: ${query}

Here is the itinerary as it was last verified. Check each stop's current status and return the itinerary again per the rules in your instructions:

${JSON.stringify(stopsForModel, null, 2)}`
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return []
  return history
    .filter((turn) => turn && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string')
    .slice(-20)
    .map((turn) => ({ role: turn.role, content: turn.content }))
}

// Shared by api/travel-assistant.js (fresh queries) and api/trip-reverify.js
// (re-checking a previously saved trip) so both go through the exact same
// generation + geocoding pipeline — a re-verify that drifted from how the
// original was built would make the "what changed" diff meaningless.
//
// Pass `reverifyItinerary` (the saved trip's existing `itinerary` array) to
// switch into audit mode: REVERIFY_SYSTEM_PROMPT + the saved stops replace
// the normal system prompt and conversation history, so the model checks
// the specific stops it's handed instead of researching the destination
// from scratch and silently producing a different itinerary.
export async function generateAnswer(query, history = [], { reverifyItinerary } = {}) {
  const anthropic = await getClient()
  const isReverify = Array.isArray(reverifyItinerary) && reverifyItinerary.length > 0
  const baseMessages = isReverify
    ? [{ role: 'user', content: buildReverifyUserMessage(query, reverifyItinerary) }]
    : [...sanitizeHistory(history), { role: 'user', content: query }]
  const requestParams = {
    // Haiku 4.5 answers simple fact-checks in ~10-20s and full itineraries in
    // ~30-40s — roughly 2-4x faster than Sonnet 5 here, with comparable
    // accuracy once search-verification is required by the system prompt.
    // Haiku doesn't support output_config.effort (errors if set) or the
    // newer web_search_20260209 dynamic-filtering tool, so this uses the
    // plain web_search_20250305 variant instead.
    model: 'claude-haiku-4-5',
    // Bumped from 4096 after the itinerary schema grew (stops are now rich
    // objects with status/statusNote/sourceUrl per stop instead of plain
    // strings) — 4096 truncated mid-JSON on a 5-day itinerary.
    max_tokens: 8192,
    system: isReverify ? REVERIFY_SYSTEM_PROMPT : SYSTEM_PROMPT,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
    output_config: {
      format: { type: 'json_schema', schema: ITINERARY_SCHEMA },
    },
  }

  let messages = baseMessages
  let response = await anthropic.messages.create({ ...requestParams, messages })

  // The server-side web-search loop caps at 10 steps; if it's still mid-verification,
  // stop_reason is "pause_turn" with no final answer yet — resume a few times.
  for (let i = 0; i < 3 && response.stop_reason === 'pause_turn'; i++) {
    messages = [...messages, { role: 'assistant', content: response.content }]
    response = await anthropic.messages.create({ ...requestParams, messages })
  }

  // Web search adds tool-use blocks before the final answer — grab the last text block.
  const textBlock = [...response.content].reverse().find((b) => b.type === 'text')
  if (!textBlock) throw new Error(`No text response from model (stop_reason: ${response.stop_reason})`)

  const parsed = JSON.parse(textBlock.text)

  if (parsed.itinerary?.length > 0) {
    try {
      parsed.itinerary = await enrichItinerary(parsed.itinerary)
    } catch (geoErr) {
      // Geocoding/coherence failure shouldn't take down the whole answer —
      // fall back to the model's ungeocoded itinerary (no coordinates, no legs).
      console.error('itinerary geo-enrichment failed, serving ungeocoded itinerary:', geoErr)
    }
  }

  // Server-side post-processing on top of the model's output, same pattern
  // as itinerary geocoding — never ask the model itself for an image URL,
  // it has no reliable way to know a real one. Rides along automatically
  // with existing caching (query cache, saved itineraries, /explore) since
  // it's just another field on the stored payload.
  parsed.destinationImage = parsed.destination ? await getDestinationImage(parsed.destination) : null

  return parsed
}

import Anthropic from '@anthropic-ai/sdk'
import { getVercelOidcToken } from '@vercel/oidc'
import { enrichItinerary } from './_lib/itineraryGeo.js'

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
                  description: 'The city or town this place is in, e.g. "Kyoto" — required for accurate geocoding, never omit',
                },
                proximity: {
                  type: 'string',
                  enum: ['in-city', 'day-trip'],
                  description:
                    'Whether this stop is inside the destination city/town itself ("in-city") or a legitimate excursion outside it — a volcano hike, a lake, a nearby coastal or countryside trip ("day-trip"). This controls how far from the city center a match is allowed to be, so get it right: marking a genuine day-trip as "in-city" can cause it to be wrongly rejected as too far away.',
                },
                category: { type: 'string', description: 'Short category, e.g. temple, restaurant, museum, park, viewpoint, market' },
                timeOfDay: { type: 'string', enum: ['morning', 'midday', 'afternoon', 'evening', 'night'] },
                durationMinutes: { type: 'integer', description: 'Realistic time to spend here, in minutes' },
                why: { type: 'string', description: 'One short sentence on why this stop, specific to this traveler’s question' },
                status: {
                  type: 'string',
                  enum: ['open', 'closed', 'seasonal', 'unverified'],
                  description:
                    'This stop’s current operating status, based on what you actually found searching. Use "unverified" honestly whenever you could not confirm current status — never default to "open" as an assumption just because a place is well-known.',
                },
                statusNote: {
                  type: 'string',
                  description:
                    'Brief note backing up the status, e.g. "closed for renovation until 2027", "seasonal, open June-August only", or "could not find current hours during search" when unverified.',
                },
                sourceUrl: {
                  type: 'string',
                  description: 'URL of the specific source used to verify this stop’s status, if you have one; empty string if none.',
                },
              },
              required: ['name', 'searchName', 'city', 'proximity', 'category', 'timeOfDay', 'durationMinutes', 'why', 'status', 'statusNote', 'sourceUrl'],
              additionalProperties: false,
            },
          },
        },
        required: ['day', 'title', 'stops'],
        additionalProperties: false,
      },
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
  required: ['destination', 'answer', 'bestTimeToVisit', 'suggestions', 'itinerary', 'sources', 'followUps'],
  additionalProperties: false,
}

const SYSTEM_PROMPT = `You are a meticulous, knowledgeable travel guide. You have live web search — you must use it, not memory alone, for anything time-sensitive or checkable: prices, hours, seasonal status, closures, damage, safety incidents, and any specific named place you plan to mention.

Before recommending or describing ANY specific named place (a landmark, museum, restaurant, trail, venue), search to confirm it is still open, operating, and in the condition you describe. Historic sites, restaurants, and attractions close, burn down, get demolished, or change — recommending one as if nothing has changed when it has is a serious factual error. If a place you would normally suggest has recently closed, been destroyed, or is under renovation, say so plainly instead of recommending it as open, and offer a real current alternative if one exists.

If the traveler's question itself references a specific event, incident, or claim (e.g. "did X burn down", "is Y still open", "what happened to Z"), your top priority is verifying that exact claim via search and answering it directly and accurately — do not sidestep it with generic suggestions.

Answer the traveler's question directly and warmly, grounded in what you actually found searching, then propose a short list of suggestions — each checked for current accuracy — and, when the question implies a trip (a duration, "plan a trip", "itinerary", etc.), a day-by-day itinerary. If no trip length is implied, return an empty itinerary array.

For every itinerary stop, put the verification work directly into that stop's "status" and "statusNote" fields — this is not just narrative for your answer text, it's structured data the app relies on. Mark a stop "open" only when you found current evidence it's operating, "closed" or "seasonal" when you found evidence of that, and "unverified" whenever you could not confirm current status via search — never default to "open" as a convenient assumption just because a place is famous or you're confident from memory. Do not include a stop's coordinates; the app geocodes each stop server-side from its "searchName" and city.

"name" and "searchName" serve different jobs — do not conflate them. "name" is what the traveler reads and can carry a clarifying qualifier ("Catedral de Santiago (Santiago Cathedral)"). "searchName" is only ever fed to a map search, so it must be the bare official/local-language name with nothing else attached — no parentheses, no "aka", no English translation tacked on, no descriptive suffix like "- Parish & Ruins". An English name for a place that locals and maps refer to by a different name is the single most common way a search fails outright: default to the local-language name in "searchName" whenever the place is not itself an English-named place, even if "name" stays in English for the traveler.

Set "proximity" honestly per stop: "in-city" for anything inside the destination town/city itself, "day-trip" for a genuine excursion outside it (a volcano hike, a lake, a nearby countryside or coastal trip). This is load-bearing, not decorative — it controls how far from the city center a match is allowed to be before the app rejects it as wrong. Marking a real day trip as "in-city" will cause the app to throw out a correct result as "too far away."

List the real sources you used in "sources", including whatever you used to verify current status.
Finally, propose 2-4 "followUps" — concrete next questions this specific traveler would plausibly ask next, based on what they just asked and what you just told them (deeper logistics on something you mentioned, food, lodging, a nearby alternative, or building an itinerary if you didn't already give one). These must follow directly from this answer, not be interchangeable boilerplate that could apply to any destination.
This may be an ongoing conversation — if earlier turns are included, treat the new question as a follow-up (e.g. still about the same destination or trip) unless the traveler clearly changes topic, and don't repeat details already covered.`

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return []
  return history
    .filter((turn) => turn && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string')
    .slice(-20)
    .map((turn) => ({ role: turn.role, content: turn.content }))
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { query, history } = req.body ?? {}
  if (!query || typeof query !== 'string') {
    res.status(400).json({ error: "Missing 'query' string in request body" })
    return
  }

  try {
    const anthropic = await getClient()
    const baseMessages = [...sanitizeHistory(history), { role: 'user', content: query }]
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
      system: SYSTEM_PROMPT,
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

    res.status(200).json(parsed)
  } catch (err) {
    console.error('travel-assistant error:', err)
    res.status(502).json({ error: 'Failed to generate travel answer' })
  }
}

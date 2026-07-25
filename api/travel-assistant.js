import Anthropic from '@anthropic-ai/sdk'
import { getVercelOidcToken } from '@vercel/oidc'

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
          activities: { type: 'array', items: { type: 'string' } },
        },
        required: ['day', 'title', 'activities'],
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

Answer the traveler's question directly and warmly, grounded in what you actually found searching, then propose a short list of suggestions — each checked for current accuracy — and, when the question implies a trip (a duration, "plan a trip", "itinerary", etc.), a day-by-day itinerary using only currently-open places. If no trip length is implied, return an empty itinerary array.
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
      max_tokens: 4096,
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

    res.status(200).json(JSON.parse(textBlock.text))
  } catch (err) {
    console.error('travel-assistant error:', err)
    res.status(502).json({ error: 'Failed to generate travel answer' })
  }
}

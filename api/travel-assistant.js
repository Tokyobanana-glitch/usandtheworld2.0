import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic() // reads ANTHROPIC_API_KEY from env — never expose this in the browser

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
  },
  required: ['destination', 'answer', 'bestTimeToVisit', 'suggestions', 'itinerary', 'sources'],
  additionalProperties: false,
}

const SYSTEM_PROMPT = `You are a knowledgeable, enthusiastic travel guide. Use web search to ground your answer in current, accurate information (prices, seasons, opening hours, events, safety notes) — don't rely on memory alone for anything time-sensitive.
Answer the traveler's question directly and warmly, then propose a short list of suggestions and, when the question implies a trip (a duration, "plan a trip", "itinerary", etc.), a day-by-day itinerary. If no trip length is implied, return an empty itinerary array.
List the real sources you used in "sources".`

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { query } = req.body ?? {}
  if (!query || typeof query !== 'string') {
    res.status(400).json({ error: "Missing 'query' string in request body" })
    return
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-8', // swap to "claude-sonnet-5" for lower latency/cost
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }],
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: ITINERARY_SCHEMA },
      },
      messages: [{ role: 'user', content: query }],
    })

    // Web search adds tool-use blocks before the final answer — grab the last text block.
    const textBlock = [...response.content].reverse().find((b) => b.type === 'text')
    if (!textBlock) throw new Error('No text response from model')

    res.status(200).json(JSON.parse(textBlock.text))
  } catch (err) {
    console.error('travel-assistant error:', err)
    res.status(502).json({ error: 'Failed to generate travel answer' })
  }
}

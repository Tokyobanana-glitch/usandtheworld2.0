import { generateText } from 'ai'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { query } = req.body ?? {}

  if (!query || typeof query !== 'string' || !query.trim()) {
    res.status(400).json({ error: 'Type a place or a question to search.' })
    return
  }

  try {
    const { text } = await generateText({
      model: 'anthropic/claude-sonnet-5',
      instructions:
        'You are the search intelligence behind "Us and The World", a travel discovery ' +
        'site. A visitor just searched for a destination or asked a travel question. ' +
        'Reply directly and vividly: say what the place is known for, the best time to ' +
        'visit, a few top things to do, and directly answer their question if they asked ' +
        'one. If the search is not a real place or travel question, say so briefly and ' +
        'suggest a real destination instead. Write flowing prose, no headers or markdown, ' +
        'under 150 words.',
      prompt: query.trim(),
    })

    res.status(200).json({ answer: text })
  } catch (error) {
    console.error('search error', error)
    res.status(500).json({
      error: 'Could not reach the world right now. Please try again in a moment.',
    })
  }
}

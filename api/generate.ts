// api/generate.ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import OpenAI from 'openai'

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ msg: 'Method Not Allowed' })
  try {
    const { prompt, system, model } = req.body ?? {}

    const out = await client.chat.completions.create({
      model: model ?? 'gpt-4o-mini',
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: prompt ?? '' }
      ],
    })

    res.status(200).json({ text: out.choices[0]?.message?.content ?? '' })
  } catch (e: any) {
    console.error(e)
    res.status(500).json({ msg: 'Server error', detail: String(e?.message ?? e) })
  }
}

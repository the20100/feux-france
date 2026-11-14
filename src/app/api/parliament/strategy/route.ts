import {NextRequest, NextResponse} from 'next/server';
import {miscGet, miscSet} from '@/lib/cache';

export const dynamic = 'force-dynamic';

const KEY = (process.env.OPENROUTER_API_KEY || '').trim();
// Free models first; OpenRouter tries them in order (`models` routing). Override with PARLIAMENT_AI_MODELS=a,b,c
const MODELS = (process.env.PARLIAMENT_AI_MODELS || 'baidu/ernie-5.5-flash-preview:free,nvidia/nemotron-3-ultra-550b-a55b:free,google/gemma-4-31b-it:free')
  .split(',').map(m => m.trim()).filter(Boolean).slice(0, 3);
const DAILY = Number(process.env.PARLIAMENT_AI_DAILY || 80); // answers per UTC day, whole site

const SYSTEM = `You are a parliamentary strategy analyst for the French Assemblée nationale.
You receive a factual briefing computed from public voting records and an Orcet model estimate, then a question.
Rules:
- Use ONLY the briefing. Never invent deputies, figures, positions, quotes or contact details.
- Everything is an estimate; say so briefly when giving numbers. Orcet's mean is not a probability of adoption.
- Advocate only legitimate, transparent democratic engagement: meetings, arguments, coalition building, public hearings, getting allies to attend. Never suggest pressure, inducements, threats or anything unethical or unlawful. Mention the HATVP register of interest representatives when relevant.
- Be concrete and prioritised: who, why, through whom, in which order. Short paragraphs or bullet lists, under 220 words.
- Answer in the language of the question.`;

export async function POST(req: NextRequest) {
  if (!KEY) return NextResponse.json({error: 'no_key'}, {status: 503});
  let body: {question?: string; briefing?: string; history?: {role: string; content: string}[]};
  try { body = await req.json(); } catch { return NextResponse.json({error: 'bad_json'}, {status: 400}); }
  const question = (body.question || '').trim().slice(0, 600);
  const brief = (body.briefing || '').slice(0, 6000);
  if (!question || !brief) return NextResponse.json({error: 'missing'}, {status: 400});

  const day = new Date().toISOString().slice(0, 10);
  const bkey = `parl_ai_budget:${day}`;
  const used = miscGet<{n: number}>(bkey, 86400) || {n: 0};
  if (used.n >= DAILY) return NextResponse.json({error: 'budget', detail: `Daily limit reached (${DAILY} answers). Try again tomorrow.`}, {status: 429});

  const history = (body.history || []).slice(-6).filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').map(m => ({role: m.role, content: m.content.slice(0, 1500)}));
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${KEY}`},
      body: JSON.stringify({models: MODELS, max_tokens: 600, temperature: 0.4, reasoning: {exclude: true, effort: 'low'}, messages: [{role: 'system', content: SYSTEM}, {role: 'user', content: `BRIEFING\n${brief}`}, ...history, {role: 'user', content: question}]}),
      signal: AbortSignal.timeout(25000),
    });
    const text = await r.text();
    let data: any; try { data = JSON.parse(text); } catch { return NextResponse.json({error: 'upstream', detail: `AI provider returned HTTP ${r.status}`}, {status: 502}); }
    if (r.status === 429) return NextResponse.json({error: 'busy', detail: 'The free AI models are rate-limited right now. Try again in a minute.'}, {status: 429});
    const answer = data?.choices?.[0]?.message?.content?.trim();
    if (!answer) return NextResponse.json({error: 'empty', detail: data?.error?.message}, {status: 502});
    miscSet(bkey, {n: used.n + 1});
    return NextResponse.json({answer, model: data.model || MODELS[0], remaining: DAILY - used.n - 1});
  } catch (e) {
    const timeout = (e as Error).name === 'TimeoutError';
    return NextResponse.json({error: timeout ? 'timeout' : 'upstream', detail: timeout ? 'The AI took too long to answer. Try a shorter question.' : (e as Error).message}, {status: timeout ? 504 : 502});
  }
}

export async function GET() {
  return NextResponse.json({enabled: !!KEY});
}

import {NextRequest, NextResponse} from 'next/server';
import {miscGet, miscSet} from '@/lib/cache';

export const dynamic = 'force-dynamic';

const KEY = (process.env.OPENROUTER_API_KEY || '').trim();
const MODEL = (process.env.PARLIAMENT_AI_MODEL || process.env.OPENROUTER_MODEL || 'openai/gpt-5-nano').trim();
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
      body: JSON.stringify({model: MODEL, messages: [{role: 'system', content: SYSTEM}, {role: 'user', content: `BRIEFING\n${brief}`}, ...history, {role: 'user', content: question}]}),
      signal: AbortSignal.timeout(45000),
    });
    const data = await r.json();
    const answer = data?.choices?.[0]?.message?.content?.trim();
    if (!answer) return NextResponse.json({error: 'empty', detail: data?.error?.message}, {status: 502});
    miscSet(bkey, {n: used.n + 1});
    return NextResponse.json({answer, model: MODEL, remaining: DAILY - used.n - 1});
  } catch (e) {
    return NextResponse.json({error: 'upstream', detail: (e as Error).message}, {status: 502});
  }
}

export async function GET() {
  return NextResponse.json({enabled: !!KEY});
}

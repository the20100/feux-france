import {NextRequest, NextResponse} from 'next/server';
import {miscGet, miscSet} from '@/lib/cache';

export const dynamic = 'force-dynamic';

const KEY = (process.env.OPENROUTER_API_KEY || '').trim();
// Free models first; OpenRouter tries them in order (`models` routing). Override with PARLIAMENT_AI_MODELS=a,b,c
const MODELS = (process.env.PARLIAMENT_AI_MODELS || 'nvidia/nemotron-3-ultra-550b-a55b:free,baidu/ernie-5.5-flash-preview:free,google/gemma-4-31b-it:free')
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
  if (!KEY) return NextResponse.json({error: 'no_key'});
  let body: {question?: string; briefing?: string; history?: {role: string; content: string}[]};
  try { body = await req.json(); } catch { return NextResponse.json({error: 'bad_json'}, {status: 400}); }
  const question = (body.question || '').trim().slice(0, 600);
  const brief = (body.briefing || '').slice(0, 6000);
  if (!question || !brief) return NextResponse.json({error: 'missing'}, {status: 400});

  const day = new Date().toISOString().slice(0, 10);
  const bkey = `parl_ai_budget:${day}`;
  const used = miscGet<{n: number}>(bkey, 86400) || {n: 0};
  if (used.n >= DAILY) return NextResponse.json({error: 'budget', detail: `Daily limit reached (${DAILY} answers). Try again tomorrow.`});

  const history = (body.history || []).slice(-6).filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').map(m => ({role: m.role, content: m.content.slice(0, 1500)}));
  const messages = [{role: 'system', content: SYSTEM}, {role: 'user', content: `BRIEFING\n${brief}`}, ...history, {role: 'user', content: question}];
  // Free models are flaky (rate limits, hidden reasoning eating the token budget): try each in turn
  // within one overall deadline, keep the first non-empty answer.
  const deadline = Date.now() + 26000;
  let last = 'no model answered';
  for (const model of MODELS) {
    const left = deadline - Date.now();
    if (left < 3000) break;
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${KEY}`},
        body: JSON.stringify({model, max_tokens: 1400, temperature: 0.4, messages}),
        signal: AbortSignal.timeout(left),
      });
      const text = await r.text();
      let data: any; try { data = JSON.parse(text); } catch { last = `${model}: HTTP ${r.status}`; continue; }
      const answer = data?.choices?.[0]?.message?.content?.trim();
      if (!answer) { last = `${model}: ${data?.error?.metadata?.raw || data?.error?.message || data?.choices?.[0]?.finish_reason || `HTTP ${r.status}`}`; continue; }
      miscSet(bkey, {n: used.n + 1});
      return NextResponse.json({answer, model: data.model || model, remaining: DAILY - used.n - 1});
    } catch (e) {
      last = `${model}: ${(e as Error).name === 'TimeoutError' ? 'timeout' : (e as Error).message}`;
    }
  }
  const busy = /429|rate/i.test(last);
  return NextResponse.json({error: busy ? 'busy' : 'upstream', detail: busy ? 'The free AI models are rate-limited right now. Try again in a minute.' : `The AI could not answer (${last.slice(0, 160)}). Please try again.`});
}

export async function GET() {
  return NextResponse.json({enabled: !!KEY});
}

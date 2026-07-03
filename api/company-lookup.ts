// api/company-lookup.ts — 현장명+주소로 회사 대표자·전화번호 역검색 (확인용, 자동저장 아님)
// Gemini + Google Search grounding으로 최대한 근거 기반. 그래도 "AI 추정"이라 사용자 확인 필수.
// ※ 다른 기능(OCR 등) 안 건드림 — 이 엔드포인트만 신규.
import type { VercelRequest, VercelResponse } from '@vercel/node';

const ALLOWED_ORIGINS = ['https://parser.work', 'https://www.parser.work'];
const MODELS = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-flash-latest'];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY 미설정' });

  const { siteName = '', address = '' } = (req.body || {}) as { siteName?: string; address?: string };
  if (!siteName && !address) return res.status(400).json({ error: 'siteName 또는 address 필수' });

  const today = new Date().toISOString().slice(0, 10);
  const prompt = `오늘(${today}) 기준으로 아래 시설/현장의 운영 법인 대표자와 대표전화번호를 최신 공개정보(포털 지도·기업정보·공시)로 확인해줘.
- 현장명: ${siteName || '(미상)'}
- 주소: ${address || '(미상)'}
주의: 서류를 제출한 '유지관리 업체'가 아니라, 이 주소지에서 실제 운영되는 현장/시설의 법인 정보를 우선한다.
확실하지 않으면 그 항목은 빈 문자열로 두고, 불확실 사유를 note에 적는다. 추측으로 채우지 말 것.
반드시 아래 JSON만 출력(설명·마크다운 없이): {"representative":"","phone":"","companyName":"","confidence":"높음|보통|낮음","note":""}`;

  const buildBody = () => ({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.1 },
  });

  let lastErr: any;
  for (const model of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    try {
      const resp = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody()), signal: AbortSignal.timeout(30_000),
      });
      const data = await resp.json() as any;
      if (data?.error) { lastErr = data.error; continue; }
      const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) { lastErr = { message: '응답 파싱 실패', raw: text.slice(0, 200) }; continue; }
      const parsed = JSON.parse(m[0]);
      return res.status(200).json({
        representative: String(parsed.representative || ''),
        phone: String(parsed.phone || ''),
        companyName: String(parsed.companyName || ''),
        confidence: String(parsed.confidence || '낮음'),
        note: String(parsed.note || ''),
        source: 'AI(검색근거) 추정 — 반드시 확인 후 적용',
      });
    } catch (e: any) { lastErr = { message: e.message }; }
  }
  return res.status(502).json({ error: '조회 실패', detail: lastErr });
}

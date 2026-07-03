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
  const prompt = `오늘(${today}) 기준으로 아래 시설/현장의 운영 법인 대표자와 대표전화번호를 최신 공개정보(포털 지도·기업정보·공시·홈페이지)로 검색해 확인해줘.
- 현장명: ${siteName || '(미상)'}
- 주소: ${address || '(미상)'}

[대표전화(phone) — 반드시 최대한 채울 것]
- 이 현장/시설을 실제 운영하는 법인의 대표전화(유선, 예: 052-###-####)를 찾아 넣는다. 010 휴대폰은 대표전화가 아니므로 넣지 않는다.
- 현장 자체 번호가 없으면 그 운영 법인(본사/모회사/SPC의 실제 운영주체)의 대표전화라도 넣는다. "번호를 못 찾았다"가 아니라, 검색으로 찾을 수 있는 가장 가까운 대표(유선)번호를 적극적으로 채운다.
- 어느 주체의 번호인지는 note에 밝힌다(예: "운영법인 비케이이엔지(주) 대표번호"). 정말 어떤 공개 유선번호도 없을 때만 빈 문자열.

[대표자(representative)]
- 운영 법인의 대표자(대표이사) 성명. 서류 제출 '유지관리 업체'가 아니라 실제 운영 주체 기준.

confidence는 높음/보통/낮음. 반드시 아래 JSON만 출력(설명·마크다운 없이):
{"representative":"","phone":"","companyName":"","confidence":"높음|보통|낮음","note":""}`;

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

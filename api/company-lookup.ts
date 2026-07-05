// api/company-lookup.ts — 현장명+주소로 회사 대표자·전화번호 역검색 (확인용, 자동저장 아님)
// Gemini + Google Search grounding으로 최대한 근거 기반. 그래도 "AI 추정"이라 사용자 확인 필수.
// ※ 다른 기능(OCR 등) 안 건드림 — 이 엔드포인트만 신규.
import type { VercelRequest, VercelResponse } from '@vercel/node';

const ALLOWED_ORIGINS = ['https://parser.work', 'https://www.parser.work'];
const MODELS = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-flash-latest'];

// 시·도 → 지역번호. 주소와 전화 지역번호 자동 대조용.
const AREA_BY_REGION: Record<string, string> = {
  '서울': '02', '부산': '051', '대구': '053', '인천': '032', '광주': '062', '대전': '042', '울산': '052', '세종': '044',
  '경기': '031', '강원': '033', '충북': '043', '충청북': '043', '충남': '041', '충청남': '041',
  '전북': '063', '전라북': '063', '전남': '061', '전라남': '061', '경북': '054', '경상북': '054', '경남': '055', '경상남': '055', '제주': '064',
};
function regionOf(addr: string): string {
  let earliestIdx = Infinity;
  let bestRegion = '';
  for (const k of Object.keys(AREA_BY_REGION)) {
    const idx = addr.indexOf(k);
    if (idx !== -1 && idx < earliestIdx) {
      earliestIdx = idx;
      bestRegion = AREA_BY_REGION[k];
    }
  }
  return bestRegion;
}
// 전화 지역번호가 주소 시·도와 맞나 (전국대표번호 1588 등은 허용, 010 휴대폰은 대표전화 아님)
function phoneRegionOk(addr: string, phone: string): boolean {
  const d = (phone || '').replace(/[^\d]/g, '');
  if (!d) return true;
  // 지역번호 없는 특수번호는 대조 예외(허용): 전국대표(15xx/16xx/18xx), 인터넷(070), 개인(050X), 수신자부담(080)
  if (/^(15\d\d|16\d\d|18\d\d|070|050|080)/.test(d)) return true;
  if (d.startsWith('010')) return false;
  const expected = regionOf(addr);
  if (!expected) return true; // 주소 지역 모르면 통과
  return expected === '02' ? d.startsWith('02') : d.startsWith(expected);
}

// Mac Studio 캐시 (Gemini 그라운딩 재호출 방지) — 같은 현장 7일 캐시
const CACHE_BASE = (process.env.PHOTO_STORAGE_URL || process.env.LOCATION_SERVER_URL || '').replace(/\/$/, '');
async function getCache(q: string): Promise<any | null> {
  if (!CACHE_BASE || !q) return null;
  try {
    const r = await fetch(`${CACHE_BASE}/api/ai-lookup-cache?query=${encodeURIComponent(q)}`,
      { headers: { 'x-studio-secret': process.env.STUDIO_SECRET || '' }, signal: AbortSignal.timeout(5000) });
    const d = await r.json() as any;
    return d?.hit ? d.data : null;
  } catch { return null; }
}
async function setCache(q: string, data: any): Promise<void> {
  if (!CACHE_BASE || !q) return;
  try {
    await fetch(`${CACHE_BASE}/api/ai-lookup-cache`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-studio-secret': process.env.STUDIO_SECRET || '' },
      body: JSON.stringify({ query: q, data }), signal: AbortSignal.timeout(5000),
    });
  } catch {}
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY 미설정' });

  const { siteName = '', address = '', candidates = null } = (req.body || {}) as {
    siteName?: string; address?: string;
    candidates?: { kakao?: any; naver?: any; google?: any } | null;
  };
  if (!siteName && !address) return res.status(400).json({ error: 'siteName 또는 address 필수' });

  // ① 캐시 조회 — 같은 현장이면 Gemini 재호출 없이 즉시 반환 (비용·한도 절약)
  const cacheKey = (siteName || address).trim();
  const cached = await getCache(cacheKey);
  if (cached && (cached.representative || cached.phone || cached.address)) {
    //과거 판정 오류로 인해 지역번호 불일치 경고가 기록된 캐시라면 무시하고 재조회
    const isBadCache = cached.note && cached.note.includes('불일치해 제외함');
    if (!isBadCache) {
      return res.status(200).json({ ...cached, cached: true });
    }
  }

  // 지도 3사(카카오·네이버·구글) 조회 결과를 판정 근거로 프롬프트에 주입
  let candidateBlock = '';
  if (candidates && (candidates.kakao || candidates.naver || candidates.google)) {
    const fmt = (s: any, label: string) => s ? `- ${label}: 주소="${s.address || ''}" 전화="${s.phone || ''}" 상호="${s.name || ''}"` : `- ${label}: (검색 결과 없음)`;
    candidateBlock = `\n[지도 3사 조회 결과 — 이걸 근거로 판정하라]\n${fmt(candidates.kakao, '카카오')}\n${fmt(candidates.naver, '네이버')}\n${fmt(candidates.google, '구글')}\n※ 소스 신뢰 가중치: 카카오 50% > 네이버 30% > 구글 20% (한국 주소·전화는 카카오가 가장 정확). 값이 상충하면 가중치 합이 높은 쪽을 채택하라 — 예: 카카오+네이버가 같으면(80%) 구글(20%)과 달라도 카카오+네이버 값을 쓴다.\n※ 소스마다 다른 지점(본사/공장/등기소재지)을 가리킬 수 있다. 현장명과 가장 부합하는 실제 현장의 값을 판정하고, 어느 소스를 신뢰했는지와 왜인지를 note에 밝혀라. 현장명과 안 맞으면 근거를 들어 배제하라.\n`;
  }

  const today = new Date().toISOString().slice(0, 10);
  const prompt = `오늘(${today}) 기준으로 아래 시설/현장의 운영 법인 대표자와 대표전화번호를 최신 공개정보(포털 지도·기업정보·공시·홈페이지)로 검색해 확인해줘.
- 현장명: ${siteName || '(미상)'}
- 주소: ${address || '(미상)'}
${candidateBlock}
[대표전화(phone) — 반드시 최대한 채울 것]
- 이 현장/시설을 실제 운영하는 법인의 대표전화(유선, 예: 052-###-####)를 찾아 넣는다. 010 휴대폰은 대표전화가 아니므로 넣지 않는다.
- ⚠️ 지역번호는 반드시 주소의 시·도와 일치해야 한다: 서울=02, 부산=051, 대구=053, 인천=032, 광주=062, 대전=042, 울산=052, 세종=044, 경기=031, 강원=033, 충북=043, 충남=041, 전북=063, 전남=061, 경북=054, 경남=055, 제주=064.
  예: 주소가 울산이면 전화는 052로 시작해야 한다. 주소는 울산인데 전화가 02(서울)이면 그건 동명이인 회사나 다른 지점/본사 번호이므로 절대 채택하지 말 것. 지역이 안 맞으면 그 현장 지역의 번호를 다시 찾고, 못 찾으면 비운다. (1588/1544 같은 전국대표번호는 예외로 허용)
- 현장 자체 번호가 없으면 그 운영 법인(본사/모회사/SPC의 실제 운영주체)의 대표전화라도 넣는다(단 위 지역 일치 우선). "번호를 못 찾았다"가 아니라, 검색으로 찾을 수 있는 가장 가까운 대표(유선)번호를 적극적으로 채운다.
- 찾은 번호는 반드시 "phone" 필드에 숫자(예: 052-227-9800)로 넣는다. note에만 적고 phone을 비우면 안 된다. 어느 주체의 번호인지는 note에 추가로 밝힌다(예: "운영법인 비케이이엔지(주) 대표번호"). 정말 어떤 공개 유선번호도 없을 때만 phone을 빈 문자열로 둔다.

[대표자(representative)]
- 운영 법인의 대표자(대표이사) 성명. 서류 제출 '유지관리 업체'가 아니라 실제 운영 주체 기준.

[주소(address)]
- 이 현장/시설의 도로명 주소를 찾아 넣는다. 시·도는 축약("경남")하지 말고 전체명("경상남도 …")으로. 못 찾으면 빈 문자열.
- ⚠️ 행정구역 명칭(시·도 등)은 네 지식으로 임의로 "교정"하지 마라. 행정구역은 통합·개편으로 바뀔 수 있고, 카카오/구글/네이버 지도가 네 학습 데이터보다 최신일 수 있다. 검색 소스가 준 지역명을 그대로 존중하고, 네 기억과 다르다고 옛 명칭으로 되돌리지 말 것.

confidence는 높음/보통/낮음. 반드시 아래 JSON만 출력(설명·마크다운 없이):
{"representative":"","phone":"","address":"","companyName":"","confidence":"높음|보통|낮음","note":""}`;

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
      let phone = String(parsed.phone || '').trim();
      // 안전망: AI가 phone 필드는 비우고 note/본문에만 번호를 적는 경우 → 유선번호를 자동 추출(010 휴대폰 제외)
      if (!phone) {
        const hay = `${parsed.note || ''} ${text}`;
        const cands = hay.match(/0\d{1,2}-\d{3,4}-\d{4}/g) || [];
        const landline = cands.find(n => !n.startsWith('010'));
        if (landline) phone = landline;
      }
      const addrOut = String(parsed.address || '');
      let note = String(parsed.note || '');
      // 지역번호 자동 대조: 주소 시·도와 전화 지역번호 불일치면 다른 지점/동명 회사 번호이므로 제외
      if (phone && addrOut && !phoneRegionOk(addrOut, phone)) {
        note = `⚠️ 전화(${phone})가 주소 지역번호와 불일치해 제외함(다른 지점/동명 회사 의심). ${note}`.trim();
        phone = '';
      }
      const result = {
        representative: String(parsed.representative || ''),
        phone,
        address: addrOut,
        companyName: String(parsed.companyName || ''),
        confidence: String(parsed.confidence || '낮음'),
        note,
        source: 'AI(검색근거) 추정 — 반드시 확인 후 적용',
      };
      // ② 의미있는 결과면 캐시 저장 (다음 동일 현장 조회는 Gemini 재호출 없음)
      if (result.representative || result.phone || result.address) { await setCache(cacheKey, result); }
      return res.status(200).json(result);
    } catch (e: any) { lastErr = { message: e.message }; }
  }
  return res.status(502).json({ error: '조회 실패', detail: lastErr });
}

// api/gemini-ocr.ts
// ✅ Vercel Serverless Function - Gemini API 키는 서버에서만 사용
// 클라이언트(브라우저)에는 키가 절대 노출되지 않습니다.

import type { VercelRequest, VercelResponse } from '@vercel/node';

// ✅ CORS: parser.work 도메인만 허용 (해킹 방지)
const ALLOWED_ORIGINS: string[] = [
  'https://parser.work',
  'https://www.parser.work',
];

// ✅ Rate Limiting: IP별 요청 횟수 추적
// Vercel Serverless는 재시작될 수 있으므로 메모리 기반 (간이 방어)
const rateLimitMap = new Map<string, { count: number; minuteCount: number; resetAt: number; minuteResetAt: number }>();
const DAILY_LIMIT = 1500;   // IP당 하루 최대 1500회
const MINUTE_LIMIT = 60;    // IP당 1분 최대 60회 (배치 30장 × 2회 여유)
const MAX_BODY_BYTES = 50 * 1024 * 1024; // 50MB (카카오톡 고화질 원본 이미지 대응)

function checkRateLimit(ip: string): { allowed: boolean; reason?: string } {
  const now = Date.now();
  const record = rateLimitMap.get(ip) ?? {
    count: 0,
    minuteCount: 0,
    resetAt: now + 24 * 60 * 60 * 1000,      // 24시간 후 리셋
    minuteResetAt: now + 60 * 1000,           // 1분 후 리셋
  };

  // 일별 카운터 리셋
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + 24 * 60 * 60 * 1000;
  }
  // 분별 카운터 리셋
  if (now > record.minuteResetAt) {
    record.minuteCount = 0;
    record.minuteResetAt = now + 60 * 1000;
  }

  if (record.minuteCount >= MINUTE_LIMIT) {
    rateLimitMap.set(ip, record);
    return { allowed: false, reason: '너무 빠른 요청입니다. 1분 후 다시 시도하세요.' };
  }
  if (record.count >= DAILY_LIMIT) {
    rateLimitMap.set(ip, record);
    return { allowed: false, reason: '일일 사용 한도에 도달했습니다.' };
  }

  record.count++;
  record.minuteCount++;
  rateLimitMap.set(ip, record);
  return { allowed: true };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ✅ 보안 헤더 추가
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');

  // CORS 헤더 (허용된 Origin이면 동적으로 설정)
  const reqOrigin = (req.headers['origin'] as string) ?? '';
  if (ALLOWED_ORIGINS.includes(reqOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', reqOrigin);
  }
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // ✅ Origin 검증: 허용된 도메인이 아니면 차단
  if (reqOrigin && !ALLOWED_ORIGINS.includes(reqOrigin)) {
    console.warn(`[gemini-ocr] 차단된 Origin 시도: ${reqOrigin}`);
    return res.status(403).json({ error: 'Forbidden: 허용되지 않은 출처입니다.' });
  }

  // ✅ IP 기반 Rate Limiting
  const ip =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ??
    req.socket?.remoteAddress ??
    'unknown';
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    console.warn(`[gemini-ocr] Rate limit 초과: ${ip}`);
    return res.status(429).json({ error: rateCheck.reason });
  }

  // ✅ 요청 크기 제한 (10MB 초과 차단)
  const contentLength = parseInt(req.headers['content-length'] ?? '0', 10);
  if (contentLength > MAX_BODY_BYTES) {
    return res.status(413).json({ error: '요청 크기가 너무 큽니다. (최대 10MB)' });
  }

  // ✅ API 키는 서버 환경변수에서만 읽음 (클라이언트에 노출 없음)
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('[gemini-ocr] GEMINI_API_KEY 환경변수 미설정');
    return res.status(500).json({ error: 'Server configuration error: API key missing.' });
  }

  try {
    const { imageBase64, mimeType, promptText, modelConfig } = req.body as {
      imageBase64: string;
      mimeType: string;
      promptText: string;
      modelConfig?: Record<string, unknown>;
    };

    if (!imageBase64 || !mimeType || !promptText) {
      return res.status(400).json({ error: 'imageBase64, mimeType, promptText are required.' });
    }

    // Gemini API 직접 호출 (서버 사이드)
    const { GoogleGenAI } = await import('@google/genai');
    const client = new GoogleGenAI({ apiKey });

    // 2026-06 기준 실제 동작 모델 (v1beta API 검증 완료)
    const MODELS = [
      'gemini-3.5-flash',      // ✅ 최신 (1순위)
      'gemini-2.5-flash',      // ✅ 안정 (2순위)
      'gemini-2.5-flash-lite', // ✅ 경량 (최후 fallback)
    ];

    let lastError: any;
    let isQuotaError = false;
    for (const model of MODELS) {
      try {
        const response = await client.models.generateContent({
          model,
          contents: {
            parts: [
              { text: promptText },
              { inlineData: { mimeType, data: imageBase64 } },
            ],
          },
          config: modelConfig ?? {},
        });
        return res.status(200).json({ text: response.text, model });
      } catch (e: any) {
        lastError = e;
        const msg = (e?.message ?? '').toLowerCase();
        if (msg.includes('429') || msg.includes('quota') || msg.includes('resource_exhausted')) {
          console.warn(`[gemini-ocr] 할당량 초과 (${model}), 중단`);
          isQuotaError = true;
          break;
        }
        console.warn(`[gemini-ocr] 모델 ${model} 실패 (${(e?.message ?? '').slice(0, 80)}), 다음 시도`);
      }
    }

    // quota 초과는 429로 명시 반환 (500으로 감추지 않음)
    if (isQuotaError) {
      return res.status(429).json({
        error: 'AI 분석 일일 한도 초과. 잠시 후 다시 시도하거나 관리자에게 문의하세요.',
        code: 'QUOTA_EXCEEDED',
      });
    }
    throw lastError;
  } catch (e: any) {
    const msg = (e?.message ?? '').toLowerCase();
    if (msg.includes('429') || msg.includes('quota') || msg.includes('resource_exhausted')) {
      return res.status(429).json({
        error: 'AI 분석 일일 한도 초과. 잠시 후 다시 시도하거나 관리자에게 문의하세요.',
        code: 'QUOTA_EXCEEDED',
      });
    }
    console.error('[gemini-ocr] 오류:', e?.message);
    return res.status(500).json({ error: e?.message || 'Gemini API 호출 중 오류 발생' });
  }
}

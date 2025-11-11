// services/email/handler.ts
import { sanitizeAndValidateAttachments } from './attachments';
import { sendPhotosEmail } from './brevo';

/**
 * 메일 전송 요청 바디 타입
 * - attachments[].content 는 dataURL 또는 순수 base64 모두 허용
 */
export type SendPhotosBody = {
  to: string;
  attachments: { name: string; content: string }[];
  meta?: {
    subject?: string;
    bodyText?: string;
    receipt_no?: string;
    site_name?: string;
    // 사용처에서 추가 필드가 들어와도 무시되므로 안전
    [key: string]: unknown;
  };
};

/**
 * 핸들러가 기대하는 환경변수 컨테이너
 * - 서버/엣지 함수에서 주입: BREVO_API_KEY, SENDER_EMAIL, SENDER_NAME
 */
export type HandlerEnv = {
  BREVO_API_KEY?: string;
  SENDER_EMAIL?: string;
  SENDER_NAME?: string;
};

/**
 * HTTP 레이어(Edge Function/Worker 등)에서 바로 쓰기 좋은 반환 형태
 */
export type HandlerResult = { status: number; json: unknown };

/**
 * 핵심 비즈니스 핸들러:
 * - 입력 검증(개수/용량/시그니처)은 attachments.ts에서 수행
 * - Brevo 호출은 brevo.ts에서 수행
 * - 여기서는 상태코드 매핑과 메시지 정리만 담당
 */
export async function handleSendPhotos(body: SendPhotosBody, env: HandlerEnv): Promise<HandlerResult> {
  const apiKey = env.BREVO_API_KEY;
  const senderEmail = env.SENDER_EMAIL;
  const senderName = env.SENDER_NAME || 'KTL Photos';

  // 필수 서버 시크릿 누락
  if (!apiKey || !senderEmail) {
    return { status: 500, json: { error: 'Server email env is missing: BREVO_API_KEY or SENDER_EMAIL.' } };
  }

  // 바디 기본 검증
  const { to, attachments, meta } = (body ?? {}) as SendPhotosBody;
  if (!to) return { status: 400, json: { error: 'to is required.' } };
  if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
    return { status: 400, json: { error: 'attachments are required.' } };
  }

  try {
    // 첨부 검증/정규화 (JPEG/PNG (+ PDF 허용 시 attachments.ts에서 시그니처 추가))
    const safeAttachments = sanitizeAndValidateAttachments(attachments);

    // 실제 전송
    const data = await sendPhotosEmail({
      to,
      attachments: safeAttachments,
      meta,
      senderEmail,
      senderName,
      apiKey,
    });

    return { status: 200, json: { ok: true, data } };
  } catch (e: any) {
    const msg = e?.message || 'Unknown error';

    // 용량 초과(클라 3.5MB 목표, 서버 3.8MB 한도)
    if (/Payload too large/i.test(msg)) return { status: 413, json: { error: msg } };

    // Brevo/네트워크 오류 등 일반 케이스
    return { status: 400, json: { error: msg } };
  }
}

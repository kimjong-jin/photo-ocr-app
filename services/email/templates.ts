// services/email/templates.ts
export type MailContext = { site?: string; receipt?: string; bodyText?: string };
export function buildSubject(ctx: MailContext) {
  return ctx.site ? `[KTL] ${ctx.site} 사진 전달` : `[KTL] 사진 전달`;
}
export function buildBody(ctx: MailContext) {
  const lines = [
    '안녕하십니까, KTL 입니다.',
    ctx.receipt ? `접수번호: ${ctx.receipt}` : '',
    ctx.site ? `현장: ${ctx.site}` : '',
    '',
    ctx.bodyText || '요청하신 사진을 첨부드립니다.',
    '',
    '※ 본 메일은 발신 전용(no-reply) 주소에서 발송되었습니다. 회신 메일은 확인되지 않습니다.',
  ].filter(Boolean);
  return { html: lines.join('<br>'), text: lines.join('\n') };
}

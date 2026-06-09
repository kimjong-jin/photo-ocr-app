// api/issue-calc-code.ts
// 계산기 고객 접속 코드 자동 발급 (ApplicationOcrSection 카카오 전송용)

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const CALC_URL = 'https://aicalc.work/api/issue-code';
  const MCP_KEY = process.env.CALC_MCP_KEY;
  if (!MCP_KEY) return res.status(500).json({ error: 'CALC_MCP_KEY not configured' });

  const { label, days, applicantName, receiptNo } = (req.body || {}) as { label?: string; days?: number; applicantName?: string; receiptNo?: string };

  const response = await fetch(CALC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': MCP_KEY },
    body: JSON.stringify({ label: label || '', days: days || 30, applicantName: applicantName || '', receiptNo: receiptNo || '' }),
  });

  const data = await response.json();
  if (!response.ok) return res.status(response.status).json(data);
  return res.status(200).json(data);
}

// api/reverse-geocode.js
// ✅ Node.js 20 런타임 강제
export const config = { runtime: 'nodejs20.x' };

// ✅ ESM 핸들러 (Vite 프로젝트에서 안전)
export default function handler(req, res) {
  try {
    return res.status(200).json({
      ok: true,
      runtime: process.version,
      method: req.method,
      query: req.query || null,
      now: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}

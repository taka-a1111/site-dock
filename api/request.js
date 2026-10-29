// サイトドック 受付 API（結果票の請求・お問い合わせ）
// 受付内容は Supabase の sitedock_requests に保存し（外から読み出せない設定）、
// Helm の受信箱には「受付があった」ことだけを送る（メールアドレスなどは送らない）。

const SB_URL = process.env.SITEDOCK_SUPABASE_URL;
const SB_KEY = process.env.SITEDOCK_SUPABASE_KEY;

const clip = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);
const EMAIL_RE = /^[^\s@<>()"',;]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

function readJson(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 20000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

function baseDomain(host) {
  const parts = String(host || '').toLowerCase().replace(/^www\./, '').split('.');
  const two = ['co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp', 'ed.jp', 'gr.jp', 'lg.jp', 'ad.jp', 'co.uk', 'com.au'];
  const last2 = parts.slice(-2).join('.');
  return two.includes(last2) ? parts.slice(-3).join('.') : last2;
}

async function sb(path, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}`, 'content-type': 'application/json', prefer: 'return=minimal' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`supabase ${r.status} ${(await r.text()).slice(0, 200)}`);
}

module.exports = async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-type', 'application/json; charset=utf-8');
  const fail = (code, message) => { res.statusCode = code; res.end(JSON.stringify({ ok: false, message })); };
  if (req.method === 'GET') {
    // 設定の有無だけを返す（値は返さない）
    const names = Object.keys(process.env).filter(k => /SITEDOCK|SUPABASE/i.test(k)).sort();
    res.statusCode = 200;
    return res.end(JSON.stringify({ url: !!SB_URL, key: !!SB_KEY, names, env: process.env.VERCEL_ENV || null }));
  }
  if (req.method !== 'POST') return fail(405, 'POST only');
  if (!SB_URL || !SB_KEY) return fail(503, 'ただいま受付を準備しています。お手数ですが、少し時間をおいてお試しください。');

  const b = await readJson(req);
  if (b.website) return fail(400, '送信できませんでした。'); // ボット避けの見えない欄
  const kind = b.kind === 'contact' ? 'contact' : 'report';
  const email = clip(b.email, 254);
  if (!email || !EMAIL_RE.test(email)) return fail(400, 'メールアドレスの形を確かめてください。');

  let domain = clip(b.domain, 253);
  if (domain) domain = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '');
  if (kind === 'report' && !domain) return fail(400, '診断したサイトのURLがありません。もう一度診断してください。');

  const mailDomain = email.split('@')[1].toLowerCase();
  const needsOwnerCheck = !!domain && baseDomain(mailDomain) !== baseDomain(domain);

  const row = {
    kind,
    domain,
    email,
    name: clip(b.name, 100),
    company: clip(b.company, 150),
    tel: clip(b.tel, 40),
    topic: clip(b.topic, 60),
    message: clip(b.message, 4000),
    overall: clip(b.overall, 20),
    needs_owner_check: needsOwnerCheck,
    status: 'new',
  };

  try {
    await sb('sitedock_requests', row);
  } catch (e) {
    console.error(e);
    return fail(502, '受付に失敗しました。お手数ですが、少し時間をおいてもう一度お試しください。');
  }

  // Helm の受信箱へ知らせる（失敗しても受付は完了扱い）
  try {
    const title = kind === 'report' ? `結果票の送付 ${domain}` : `お問い合わせ ${row.topic || ''}`.trim();
    const note = [
      kind === 'report' ? `・無料簡易診断の結果票の請求（総合判定：${row.overall || '不明'}）` : `・お問い合わせ（${row.topic || '種類なし'}）${domain ? ' 対象 ' + domain : ''}`,
      needsOwnerCheck ? '・メールのドメインがサイトと違うため、持ち主の確認が先に必要' : '',
      '・連絡先と本文は Supabase の sitedock_requests を見る',
    ].filter(Boolean).join('\n');
    await sb('rpc/helm_intake_post', { p_source: 'サイトドック（自動受付）', p_project: 'サイトドック', p_payload: { add: [{ title, note }] } });
  } catch (e) { console.error('helm', e.message); }

  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true, needsOwnerCheck }));
};

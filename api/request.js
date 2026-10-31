// スキゼロ 受付 API（結果票の請求・お問い合わせ）
// 受付内容は Supabase の sitedock_requests に保存する（外から読み出せない設定。RPC は token を知っている1件だけ扱える）。
// 結果票の請求は、その場で受け付けを返し、裏で「診断 → 結果票PDF → メール送付」まで自動で進める。
// メールのドメインがサイトと違うときは、先に持ち主の確認のお願いを送る（api/verify.js で確認）。
// Helm の受信箱には、受付と結果だけを送る（メールアドレスなどは送らない）。

const { waitUntil } = require('@vercel/functions');
const flow = require('../lib/flow.js');

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

module.exports = async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-type', 'application/json; charset=utf-8');
  const fail = (code, message) => { res.statusCode = code; res.end(JSON.stringify({ ok: false, message })); };
  if (req.method !== 'POST') return fail(405, 'POST only');
  if (!flow.configured()) return fail(503, 'ただいま受付を準備しています。お手数ですが、少し時間をおいてお試しください。');

  const b = await readJson(req);
  if (b.website) return fail(400, '送信できませんでした。'); // ボット避けの見えない欄
  const kind = b.kind === 'contact' ? 'contact' : 'report';
  const email = clip(b.email, 254);
  if (!email || !EMAIL_RE.test(email)) return fail(400, 'メールアドレスの形を確かめてください。');

  let domain = clip(b.domain, 253);
  if (domain) domain = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '');
  if (kind === 'report' && !domain) return fail(400, '診断したサイトのURLがありません。もう一度診断してください。');

  const mailDomain = email.split('@')[1].toLowerCase();
  const needsOwnerCheck = kind === 'report' && baseDomain(mailDomain) !== baseDomain(domain);

  const row = {
    kind, domain, email,
    name: clip(b.name, 100), company: clip(b.company, 150), tel: clip(b.tel, 40),
    topic: clip(b.topic, 60), message: clip(b.message, 4000), overall: clip(b.overall, 20),
    needs_owner_check: !!(domain && needsOwnerCheck),
  };

  let created;
  try {
    created = await flow.createRequest(row);
  } catch (e) {
    if (/rate/.test(e.body || e.message)) return fail(429, '同じサイトやメールアドレスでの受付が続いています。結果票は1日3回までお送りできます。明日以降にお試しください。');
    console.error(e);
    return fail(502, '受付に失敗しました。お手数ですが、少し時間をおいてもう一度お試しください。');
  }
  const { id, token, verify_code: verifyCode } = created;

  if (kind === 'contact') {
    await flow.helm(`お問い合わせ ${row.topic || ''}`.trim(), [
      `・お問い合わせ（${row.topic || '種類なし'}）${domain ? ' 対象 ' + domain : ''}`,
      '・連絡先と本文は Supabase の sitedock_requests を見る',
    ].join('\n'));
  } else if (row.needs_owner_check) {
    waitUntil(flow.sendOwnerCheck(id, token, verifyCode, row));
  } else {
    waitUntil(flow.processReport(id, token));
  }

  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true, needsOwnerCheck: row.needs_owner_check }));
};

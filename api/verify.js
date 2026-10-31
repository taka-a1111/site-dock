// スキゼロ 持ち主の確認（結果票の送付前）
// 確認のメールにあるURLを開くと、サイトの <head> の確認用の1行、またはドメインのTXT記録を確かめ、
// 見つかれば結果票の作成と送付を始める。

const { waitUntil } = require('@vercel/functions');
const flow = require('../lib/flow.js');
const { get, txt, normalize } = require('../api/scan.js');

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page(title, body, status = 200) {
  return { status, html: `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}｜スキゼロ</title>
<style>body{margin:0;background:#F1F4F2;color:#12343B;font-family:"BIZ UDPGothic","游ゴシック","Yu Gothic","メイリオ","Noto Sans JP",sans-serif;line-height:1.8}
main{max-width:640px;margin:48px auto;background:#fff;border:1px solid #C9D9D2;border-radius:8px;padding:32px 28px}
h1{font-size:22px;margin:0 0 12px}p{margin:10px 0;font-size:15px}code{display:block;background:#F4F6F5;border:1px solid #E3ECE8;padding:10px 12px;font-size:13px;word-break:break-all;margin:6px 0}
a.btn{display:inline-block;margin-top:14px;background:#2F7D5B;color:#fff;text-decoration:none;padding:12px 22px;border-radius:3px;font-weight:700}
.logo{font-weight:900;font-size:18px;margin-bottom:18px}.logo a{color:#12343B;text-decoration:none}
@media (max-width:680px){main{margin:16px;padding:24px 18px}}</style></head>
<body><main><div class="logo"><a href="/">スキゼロ</a></div><h1>${esc(title)}</h1>${body}</main></body></html>` };
}

async function hasMeta(host, code) {
  for (const url of [`https://${host}/`, `http://${host}/`]) {
    const r = await get(url, { max: 400 * 1024, timeout: 8000 }).catch(() => ({}));
    if (!r || !r.body) continue;
    const metas = r.body.match(/<meta[^>]+>/gi) || [];
    if (metas.some(m => /name\s*=\s*["'](?:sukizero|site-dock)-verification["']/i.test(m) && m.includes(code))) return true;
    return false;
  }
  return false;
}

async function hasTxt(host, code) {
  const names = [host, host.replace(/^www\./, '')];
  for (const n of [...new Set(names)]) {
    const t = await txt(n).catch(() => null);
    if (t && t.some(v => [`sukizero-verification=${code}`, `site-dock-verification=${code}`].includes(v.trim()))) return true;
  }
  return false;
}

module.exports = async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-type', 'text/html; charset=utf-8');
  const send = p => { res.statusCode = p.status; res.end(p.html); };
  const q = req.query || {};
  const id = parseInt(q.id, 10);
  const token = String(q.t || '');
  if (!flow.configured()) return send(page('ただいま準備中です', '<p>少し時間をおいて、もう一度このページを開いてください。</p>', 503));
  if (!id || !/^[0-9a-f]{48}$/.test(token)) return send(page('リンクが正しくありません', '<p>メールに書かれたURLを、最後まで正しく開いてください。</p>', 400));

  let row;
  try { row = await flow.getRequest(id, token); } catch (e) { console.error(e); }
  if (!row) return send(page('リンクが正しくありません', '<p>メールに書かれたURLを、最後まで正しく開いてください。</p>', 404));
  if (row.status === 'sent') return send(page('結果票はお送り済みです', `<p>${esc(row.domain)} の結果票は、すでに ${esc(row.email)} へお送りしています。届いていない場合は、迷惑メールのフォルダもご確認ください。</p>`));
  if (row.status === 'working') return send(page('結果票を作っています', `<p>${esc(row.domain)} の結果票を作っています。数分で ${esc(row.email)} へ届きます。</p>`));
  if (Date.now() - new Date(row.created_at).getTime() > 7 * 86400000) {
    return send(page('URLの有効期限が切れています', '<p>お手数ですが、トップページからもう一度診断し、結果票をお申し込みください。</p><a class="btn" href="/">もう一度診断する</a>', 410));
  }

  if (!row.verified_at) {
    const host = normalize(row.domain);
    const ok = host && ((await hasMeta(host, row.verify_code)) || (await hasTxt(host, row.verify_code)));
    if (!ok) {
      return send(page('まだ確認用の1行が見つかりません', `<p>${esc(row.domain)} のトップページの &lt;head&gt; の中、またはドメインのTXT記録に、確認用の1行が見つかりませんでした。</p>
<p>サイトに入れる場合：</p><code>&lt;meta name="sukizero-verification" content="${esc(row.verify_code)}"&gt;</code>
<p>DNSに足す場合（TXT記録）：</p><code>sukizero-verification=${esc(row.verify_code)}</code>
<p>キャッシュ用のプラグインを使っている場合は、キャッシュを消してからお試しください。DNSは反映まで数十分かかることがあります。</p>
<a class="btn" href="/api/verify?id=${id}&amp;t=${esc(token)}">入れたので、もう一度確かめる</a>`));
    }
    await flow.updateRequest(id, token, { verified: true, status: 'queued' });
  }

  waitUntil(flow.processReport(id, token));
  return send(page('確認できました', `<p>${esc(row.domain)} の持ち主であることを確認しました。これから結果票を作り、${esc(row.email)} へお送りします。</p>
<p>数分で届きます。届かない場合は、迷惑メールのフォルダもご確認ください。確認用の1行は、もう消していただいてかまいません。</p>
<a class="btn" href="/">トップページへ</a>`));
};

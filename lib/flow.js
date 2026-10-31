// スキゼロ 結果票の自動送付の流れ
// 受付 → （必要なら持ち主の確認）→ 診断 → 結果票PDF → 控えを保存 → メールで送付 → Helm に知らせる
//
// 使う環境変数
//   SITEDOCK_SUPABASE_URL / SITEDOCK_SUPABASE_KEY … 受付の保存（RPC 経由。token を知っている1件だけ読み書きできる）
//   RESEND_API_KEY … メール送信（未設定なら、PDFを作って控えに保存し、Helm に「送信の設定待ち」と知らせる）
//   SITEDOCK_MAIL_FROM … 差出人（既定：スキゼロ <report@site-dock.com>）

const { runScan, normalize } = require('../api/scan.js');
const { buildReportHtml } = require('./report.js');

const SB_URL = process.env.SITEDOCK_SUPABASE_URL;
const SB_KEY = process.env.SITEDOCK_SUPABASE_KEY;
const RESEND = process.env.RESEND_API_KEY;
const FROM = process.env.SITEDOCK_MAIL_FROM || 'スキゼロ <report@site-dock.com>';
const SITE = 'https://sukizero.com';
const GL = { A: '問題なし', B: '軽い注意', C: '要注意', D: '要対策', E: '至急対策', '-': '確認できず' };
const ORDER = { A: 1, B: 2, C: 3, D: 4, E: 5 };

const sbHeaders = () => ({ apikey: SB_KEY, authorization: `Bearer ${SB_KEY}`, 'content-type': 'application/json' });

async function rpc(name, args) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: sbHeaders(), body: JSON.stringify(args), signal: AbortSignal.timeout(8000) });
  const text = await r.text();
  if (!r.ok) { const e = new Error(`supabase ${name} ${r.status} ${text.slice(0, 200)}`); e.body = text; throw e; }
  return text ? JSON.parse(text) : null;
}

const createRequest = p => rpc('sitedock_request_create', { p });
const getRequest = (id, token) => rpc('sitedock_request_get', { p_id: id, p_token: token });
const updateRequest = (id, token, p) => rpc('sitedock_request_update', { p_id: id, p_token: token, p }).catch(e => console.error('update', e.message));

async function helm(title, note) {
  if (process.env.SITEDOCK_NO_HELM) { console.log('[helm skipped]', title); return; }
  try { await rpc('helm_intake_post', { p_source: 'スキゼロ（自動受付）', p_project: 'スキゼロ', p_payload: { add: [{ title, note }] } }); }
  catch (e) { console.error('helm', e.message); }
}

async function uploadPdf(path, buf) {
  const r = await fetch(`${SB_URL}/storage/v1/object/sitedock-reports/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST', headers: { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}`, 'content-type': 'application/pdf', 'x-upsert': 'false' }, body: buf, signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`storage ${r.status} ${(await r.text()).slice(0, 200)}`);
}

async function sendMail({ to, subject, text, attachments }) {
  const html = '<div style="font-family:\'游ゴシック\',\'Yu Gothic\',\'メイリオ\',Meiryo,\'Noto Sans JP\',sans-serif;font-size:14px;line-height:1.8;color:#12343B">'
    + text.split('\n').map(l => (l ? l.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(/(https:\/\/[^\s]+)/g, '<a href="$1">$1</a>') : '&nbsp;')).join('<br>') + '</div>';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { authorization: `Bearer ${RESEND}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, text, html, attachments }), signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`resend ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

const jst = d => new Date(d.getTime() + 9 * 3600000);
const reportIdOf = (id, d = new Date()) => { const t = jst(d); return `SD-${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, '0')}${String(t.getUTCDate()).padStart(2, '0')}-${String(id).padStart(4, '0')}`; };

const SIGN = `――――――――――
スキゼロ（ホームページのセキュリティ診断）
${SITE}/
このメールは送信専用です。ご質問は、お問い合わせフォームからお送りください。
${SITE}/contact.html`;

// 結果票を作って送る（受付1件分）
async function processReport(id, token) {
  const row = await getRequest(id, token);
  if (!row || row.kind !== 'report') return { ok: false, reason: 'notfound' };
  if (row.status === 'sent') return { ok: true, reason: 'sent' };
  if (row.needs_owner_check && !row.verified_at) return { ok: false, reason: 'owner' };
  await updateRequest(id, token, { status: 'working', attempt: 1 });
  const reportId = reportIdOf(id, new Date(row.created_at));
  try {
    const host = normalize(row.domain);
    if (!host) throw new Error('bad domain');
    const scan = await runScan(host);
    if (scan.error) throw new Error('scan ' + scan.error);
    const { htmlToPdf } = require('./pdf.js');
    const pdf = await htmlToPdf(buildReportHtml(scan, { reportId }));
    const path = `${reportId.slice(3, 9)}/${reportId}_${host}.pdf`;
    let saved = true;
    try { await uploadPdf(path, pdf); } catch (e) { saved = false; console.error('upload', e.message); }
    const og = scan.overall.grade;
    const fixes = scan.rows.filter(r => ORDER[r.grade] >= 3).sort((a, b) => ORDER[b.grade] - ORDER[a.grade]).slice(0, 3);

    if (!RESEND) {
      await updateRequest(id, token, { status: 'ready_no_mail', report_path: saved ? path : null, last_error: 'RESEND_API_KEY 未設定' });
      await helm(`結果票の送付（手動） ${host}`, `・結果票（${reportId}、総合判定 ${og}）を自動で作成済み。メール送信の設定（RESEND_API_KEY）がまだのため、手動で送る\n・PDF：Supabase Storage の sitedock-reports/${path}${saved ? '' : '（保存に失敗。もう一度作り直す）'}\n・宛先は Supabase の sitedock_requests（id ${id}）を見る`);
      return { ok: true, reason: 'no_mail' };
    }

    const text = `このたびは、スキゼロの無料簡易診断をご利用いただき、ありがとうございます。
${host} の結果票（A4・全8ページ、PDF）をお送りします。

総合判定：${og}（${GL[og]}）
${fixes.length ? '先に直す項目：' + fixes.map(r => `${r.label}（${r.tag}・判定${r.grade}）`).join('、') : '先に直す必要のある弱点は、見つかりませんでした。'}

結果票の2ページ目から、項目ごとの直し方の手順を載せています。そのまま制作会社さまへ転送していただけます。
直したあとは、同じURLでもう一度診断すると、直ったかどうかを確かめられます。
${SITE}/

受付番号：${reportId}

${SIGN}`;
    await sendMail({
      to: row.email,
      subject: `【スキゼロ】結果票をお送りします（${host}）`,
      text,
      attachments: [{ filename: `スキゼロ_結果票_${host}_${reportId}.pdf`, content: pdf.toString('base64') }],
    });
    await updateRequest(id, token, { status: 'sent', sent: true, report_path: saved ? path : null, last_error: null });
    await helm(`結果票を自動送付 ${host}`, `・結果票（${reportId}、総合判定 ${og}）をメールで自動送付済み。対応は不要\n・営業の連絡はしない。返信やお問い合わせが来たら対応する`);
    return { ok: true, reason: 'sent' };
  } catch (e) {
    console.error('processReport', e);
    await updateRequest(id, token, { status: 'error', last_error: String(e.message || e) });
    await helm(`結果票の自動作成に失敗 ${row.domain}`, `・受付 id ${id}（${reportId}）の結果票を作れなかった：${String(e.message || e).slice(0, 200)}\n・サイトに一時的につながらなかった可能性。手動で作り直して送る`);
    return { ok: false, reason: 'error' };
  }
}

// 持ち主の確認のお願いを送る（メールのドメインがサイトと違うとき）
async function sendOwnerCheck(id, token, verifyCode, row) {
  const link = `${SITE}/api/verify?id=${id}&t=${token}`;
  if (!RESEND) {
    await helm(`結果票の送付（持ち主の確認が先） ${row.domain}`, `・メールのドメインがサイトと違うため、持ち主の確認が必要\n・メール送信の設定（RESEND_API_KEY）がまだのため、確認のお願いを手動で送る\n・確認用の1行：<meta name="sukizero-verification" content="${verifyCode}">\n・確認のURL：${link}`);
    return;
  }
  const text = `このたびは、スキゼロの無料簡易診断をご利用いただき、ありがとうございます。
${row.domain} の結果票をお送りする前に、サイトの持ち主であることの確認をお願いします。

結果票には、古いプラグインの名前など、攻撃の手がかりになる情報が載ります。ほかの方のサイトの結果をお送りしないよう、メールアドレスのドメインがサイトと違う場合は、確認をお願いしています。

確認の方法は、次のどちらか1つです。

方法1：サイトの <head> の中に、次の1行を入れる
<meta name="sukizero-verification" content="${verifyCode}">
（WordPressなら、テーマの「ヘッダーにコードを追加」の欄や、プラグイン「WPCode」などで入れられます）

方法2：ドメインの設定（DNS）に、次のTXT記録を足す
sukizero-verification=${verifyCode}

入れ終わったら、次のURLを開いてください。確認ができしだい、結果票を自動でお送りします。
${link}

確認が済んだら、入れた1行は消してかまいません。
このURLの有効期限は7日間です。お心当たりがない場合は、このメールを破棄してください。

${SIGN}`;
  try {
    await sendMail({ to: row.email, subject: `【スキゼロ】結果票の送付の前に、持ち主の確認をお願いします（${row.domain}）`, text });
    await helm(`持ち主の確認待ち ${row.domain}`, '・メールのドメインがサイトと違うため、確認のお願いを自動で送付済み。確認が済むと結果票も自動で送る。対応は不要');
  } catch (e) {
    console.error('ownercheck', e);
    await updateRequest(id, token, { last_error: String(e.message || e) });
    await helm(`確認メールの送信に失敗 ${row.domain}`, `・持ち主の確認のお願いを送れなかった：${String(e.message || e).slice(0, 200)}\n・確認のURL：${link}`);
  }
}

module.exports = { createRequest, getRequest, updateRequest, processReport, sendOwnerCheck, helm, reportIdOf, configured: () => !!(SB_URL && SB_KEY) };

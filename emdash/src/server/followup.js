// スキゼロ 結果票のあとの案内メール（お知らせの受け取りに同意した方だけ）
// 1通目：結果票の送付から3日後（判定に合わせた次の一手と、無料の結果説明）
// 2通目：1通目から4日後（定期診断の案内）。以降は送らない
// 定期処理（worker.ts の scheduled）から1時間に1回呼ぶ。送るのは日本時間の9時〜19時だけ
// 使う環境変数：FOLLOWUP_KEY（送り先を取り出す鍵。未設定なら何もしない）、RESEND_API_KEY、SITEDOCK_SUPABASE_URL / KEY

import { rpcCall, getRequest, updateRequest, sendMail, helmNote, reportIdOf } from './flow.js';

const envOf = k => (globalThis.process && process.env && process.env[k]) || '';
const SITE = 'https://sukizero.com';

const unsubUrl = (id, token) => `${SITE}/api/unsubscribe?id=${id}&t=${token}`;

function footer(id, token) {
  return `――――――――――
このメールは、結果票のお申し込みのときに、スキゼロからのお知らせの受け取りに同意いただいた方にお送りしています。
今後のお知らせが不要な場合は、こちらから止められます（1回のクリックで止まります）。
${unsubUrl(id, token)}

送信者：スキゼロ（インフォサクセス　高崎信吾）
〒450-0002 愛知県名古屋市中村区名駅3-4-10 アルティメイト名駅1st 2階
お問い合わせ：${SITE}/contact.html`;
}

function overallGrade(row) {
  // 受付の overall は画面の表示名（要対策・要注意・良好）
  const l = row.overall || '';
  return l === '要対策' ? 'D' : l === '要注意' ? 'C' : l === '良好' ? 'A' : '';
}

function mail1(row) {
  const host = row.domain;
  const no = reportIdOf(row.id, new Date(row.created_at));
  const g = overallGrade(row);
  const consult = `${SITE}/contact.html?plan=consult&url=${encodeURIComponent(host)}&no=${no}`;
  let mid;
  if (g === 'D') {
    mid = `前回の総合判定は「要対策」でした。D・Eの項目は、攻撃の入口になりやすいところです。
直し方が分からない、手が回らないという場合は、対策作業（14,800円から）を承ります。結果票をもとにお見積もりします。`;
  } else if (g === 'C') {
    mid = `前回の総合判定は「要注意」でした。急ぎではありませんが、1か月以内を目安に直しておくと安心です。`;
  } else {
    mid = `前回の総合判定は「良好」でした。今のところ、大きな弱点は見つかっていません。`;
  }
  return {
    subject: `【スキゼロ】結果票のその後について（${host}）`,
    text: `先日は、スキゼロの無料簡易診断をご利用いただき、ありがとうございました。
${host} の結果票（受付番号 ${no}）は、ご覧いただけましたでしょうか。

${mid}

結果票の見方や、どこから手をつけるかのご説明は無料です（オンライン30分、またはメール）。
${consult}

直したあとは、同じURLでもう一度診断すると、直ったかどうかを確かめられます。
${SITE}/

${footer(row.id, row.token)}`,
  };
}

function mail2(row) {
  const host = row.domain;
  return {
    subject: `【スキゼロ】${host} の見張りについてのご案内`,
    text: `スキゼロの無料簡易診断をご利用いただいた方に、お送りしています。

WordPressのプラグインの弱点は、毎月のように新しく公表されています。
今日は問題がなくても、来月も同じとは限りません。

定期診断ライト（月4,980円）では、週1回の自動点検と、月1回の結果票をお届けします。
${host} で使っているプラグインに新しい弱点が出たときは、メールでお知らせします。
更新作業までまとめて任せたい場合は、定期診断スタンダード（月19,800円）もございます。
どちらも1か月単位で、最低契約期間はありません。

料金とお申し込み
${SITE}/price.html

${footer(row.id, row.token)}`,
  };
}

// 1時間に1回呼ばれる。送った件数を返す
export async function runFollowups({ force = false } = {}) {
  const key = envOf('FOLLOWUP_KEY');
  if (!key || !envOf('RESEND_API_KEY')) return 0;
  const h = (new Date().getUTCHours() + 9) % 24;
  if (!force && (h < 9 || h >= 19)) return 0;
  let rows;
  try { rows = await rpcCall('sitedock_followup_due', { p_key: key }); }
  catch (e) { console.error('followup due', e.message); return 0; }
  let n = 0;
  for (const row of rows || []) {
    const m = row.follow_step === 0 ? mail1(row) : mail2(row);
    try {
      const cur = await getRequest(row.id, row.token);
      if (!cur || !cur.optin || cur.unsub_at || cur.follow_step !== row.follow_step) continue;
      await sendMail({
        to: cur.email, subject: m.subject, text: m.text,
        headers: { 'List-Unsubscribe': `<${unsubUrl(row.id, row.token)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      });
      await updateRequest(row.id, row.token, { follow_done: true });
      n++;
    } catch (e) {
      console.error('followup send', row.id, e.message);
      await updateRequest(row.id, row.token, { last_error: 'followup: ' + String(e.message || e) });
    }
  }
  if (n) await helmNote(`・結果票のあとの案内メールを自動送付（${n}件）。対応は不要`);
  return n;
}

export { mail1, mail2 };

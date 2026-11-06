// @ts-nocheck
// スキゼロ お知らせメールの停止（メールのリンク、またはメールソフトの「配信停止」ボタン）
// GET はページを表示して停止、POST（List-Unsubscribe-Post のワンクリック）は停止だけ行う
import type { APIRoute } from "astro";
import * as flow from "../../server/flow.js";

const page = (title, msg) => new Response(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}｜スキゼロ</title>
<style>body{margin:0;background:#F1F4F2;color:#12343B;font-family:"BIZ UDPGothic","游ゴシック","Yu Gothic","メイリオ",Meiryo,"Noto Sans JP",sans-serif;line-height:1.8}
main{max-width:560px;margin:56px auto;padding:32px 24px;background:#fff;border:1px solid #D5DED9}h1{font-size:20px;margin:0 0 12px}p{font-size:15px;margin:0 0 10px}a{color:#2F7D5B}</style></head>
<body><main><h1>${title}</h1><p>${msg}</p><p><a href="/">スキゼロのトップへ</a></p></main></body></html>`,
  { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });

async function stop(url) {
  const id = Number(url.searchParams.get('id'));
  const t = String(url.searchParams.get('t') || '');
  if (!id || !/^[0-9a-f]{32,64}$/.test(t)) return false;
  return !!(await flow.updateRequest(id, t, { unsub: true }));
}

export const GET: APIRoute = async ({ request }) => {
  const ok = await stop(new URL(request.url)).catch(() => false);
  return ok
    ? page('お知らせを止めました', 'スキゼロからのお知らせメールを止めました。これからはお送りしません。結果票やお問い合わせへのお返事は、これまでどおりお送りします。')
    : page('止められませんでした', 'リンクの形が正しくないか、受付が見つかりませんでした。お手数ですが、お問い合わせフォームから「お知らせの停止」とお知らせください。');
};

export const POST: APIRoute = async ({ request }) => {
  const ok = await stop(new URL(request.url)).catch(() => false);
  return new Response(ok ? 'ok' : 'ng', { status: ok ? 200 : 400, headers: { 'cache-control': 'no-store' } });
};

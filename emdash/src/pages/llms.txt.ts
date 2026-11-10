import type { APIRoute } from "astro";
import { BASE, allPosts, isLive, todayJST } from "../lib/sukizero";

/** AI検索・AIアシスタント向けの案内（llms.txt）。サービスの要点と、公開中の記事の一覧を Markdown で返す */
export const GET: APIRoute = async () => {
	const today = todayJST();
	const posts = (await allPosts())
		.filter((p) => isLive(p, today))
		.sort((a, b) => (a.date === b.date ? (a.num < b.num ? 1 : -1) : a.date < b.date ? 1 : -1));
	const body = `# スキゼロ

> スキゼロは、ホームページ（主にWordPress）のセキュリティ診断サービスです。URLを入れるだけで、公開されている情報から8項目（SSL証明書、PHP、WordPress本体、プラグイン、ユーザー名、不要なファイル、セキュリティ設定、SPF・DMARC）をA〜Eで判定する無料簡易診断を提供しています。運営はインフォサクセス（WordPress制作12年以上、SEO検定1級）です。

- 無料簡易診断は、ふつうの閲覧と同じ読み取りだけで行います。ログインの試行や書き込みはしません。登録もいりません
- 希望者には、A4・全8ページの結果票（PDF）をメールで無料でお送りします。結果票では、脆弱性情報データベース（NVD）との照合結果も載せます
- 料金（税込）：無料簡易診断 0円／詳細診断 29,800円／定期診断ライト 月4,980円／定期診断スタンダード 月19,800円／対策作業（単発）14,800円〜
- 対象は日本国内の中小企業・個人事業主のホームページと、その制作会社です

## サービス

- [無料簡易診断（トップページ）](${BASE}/): URLを入れると数十秒で8項目を判定します
- [診断について](${BASE}/service.html): 診断で見ている8項目と、判定の目安、診断の限界
- [料金](${BASE}/price.html): プランの比較、対策作業、お支払いと契約の条件
- [よくある質問](${BASE}/faq.html): 診断の安全性、料金と契約、対策作業についての質問と答え
- [制作会社さまへ](${BASE}/partner.html): 制作会社・保守会社向けの案内
- [お問い合わせ](${BASE}/contact.html): 結果票の無料説明、詳細診断、定期診断、対策作業の見積もりの申し込み
- [運営者情報](${BASE}/about.html): 運営者と所在地

## ブログ記事

${posts.map((p) => `- [${p.title}](${BASE}/blog/${p.slug}.html): ${p.description}（${p.cat}、${p.modified || p.date}）`).join("\n")}

## そのほか

- [ブログ一覧](${BASE}/blog/index.html)
- [RSS](${BASE}/feed.xml)
- [サイトマップ](${BASE}/sitemap.xml)
`;
	return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=600" } });
};

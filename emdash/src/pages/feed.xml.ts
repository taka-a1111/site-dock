import type { APIRoute } from "astro";
import { BASE, allPosts, isLive, todayJST } from "../lib/sukizero";

const x = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** 公開日（日本時間の朝9時）を RSS の日付の書き方にする */
const rfc822 = (d: string) => new Date(`${d}T09:00:00+09:00`).toUTCString();

/** ブログの RSS（公開中の記事を新しい順に30件） */
export const GET: APIRoute = async () => {
	const today = todayJST();
	const posts = (await allPosts())
		.filter((p) => isLive(p, today))
		.sort((a, b) => (a.date === b.date ? (a.num < b.num ? 1 : -1) : a.date < b.date ? 1 : -1))
		.slice(0, 30);
	const items = posts
		.map((p) => {
			const url = `${BASE}/blog/${p.slug}.html`;
			return `<item><title>${x(p.title)}</title><link>${url}</link><guid isPermaLink="true">${url}</guid><pubDate>${rfc822(p.date)}</pubDate><category>${x(p.cat)}</category><description>${x(p.description)}</description></item>`;
		})
		.join("\n");
	const last = posts.length ? rfc822(posts[0].modified || posts[0].date) : rfc822(today);
	return new Response(
		`<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>スキゼロ ブログ</title><link>${BASE}/blog/index.html</link><description>ホームページのセキュリティを守るための知識。PHPの更新、改ざんの見分け方、WordPressの設定まで。</description><language>ja</language><lastBuildDate>${last}</lastBuildDate><atom:link href="${BASE}/feed.xml" rel="self" type="application/rss+xml"/>\n${items}\n</channel></rss>\n`,
		{ headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=600" } },
	);
};

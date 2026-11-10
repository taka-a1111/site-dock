import type { APIRoute } from "astro";
import { BASE, FIXED, FIXED_LASTMOD, allPosts, isLive, todayJST } from "../lib/sukizero";

/** サイトマップ（Vercel版と同じ並び：固定ページ → ブログ一覧 → 公開中の記事を slug 順） */
export const GET: APIRoute = async () => {
	const today = todayJST();
	const posts = (await allPosts()).filter((p) => isLive(p, today)).sort((a, b) => (a.slug < b.slug ? -1 : 1));
	// 特商法・プライバシー・利用規約は noindex にしているので載せない（2026-11-05）
	const fixed = ["about", "contact", "faq", "index", "partner", "price", "service"].filter(
		(n) => n === "index" || FIXED.includes(n),
	);
	/** ページごとの最終更新日。直したページだけここに書く（無ければ FIXED_LASTMOD） */
	const LASTMOD: Record<string, string> = {};
	const url = (loc: string, lastmod: string) => `  <url><loc>${loc}</loc><lastmod>${lastmod}</lastmod></url>`;
	const newest = posts.reduce((m, p) => ((p.modified || p.date) > m ? p.modified || p.date : m), FIXED_LASTMOD);
	const lines = [
		...fixed.map((n) => url(n === "index" ? `${BASE}/` : `${BASE}/${n}.html`, LASTMOD[n] || FIXED_LASTMOD)),
		url(`${BASE}/blog/index.html`, newest),
		...posts.map((p) => url(`${BASE}/blog/${p.slug}.html`, p.modified || p.date)),
	];
	return new Response(
		`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${lines.join("\n")}\n</urlset>\n`,
		{ headers: { "content-type": "application/xml; charset=utf-8" } },
	);
};

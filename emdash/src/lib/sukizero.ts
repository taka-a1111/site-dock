/**
 * スキゼロの表示まわり。
 * 固定ページは src/site/pages/*.html（Vercel版と同じHTML）をそのまま返し、記事カードの欄 {{CARDS}} だけ D1 の記事から作る。
 * 記事ページは src/site/article.html に build.py と同じ置き換えをして作る（Vercel版と同じHTMLになる）。
 */
import { getEmDashCollection, getEmDashEntry } from "emdash";
import articleTpl from "../site/article.html?raw";

const pageFiles = import.meta.glob("../site/pages/*.html", {
	query: "?raw",
	import: "default",
	eager: true,
}) as Record<string, string>;

export const PAGES: Record<string, string> = Object.fromEntries(
	Object.entries(pageFiles).map(([k, v]) => [k.replace(/^.*\//, "").replace(/\.html$/, ""), v]),
);

/** 固定ページ（URL は /<名前>.html）。index と blog-index と 404 は別に扱う */
export const FIXED = ["service", "price", "partner", "faq", "about", "contact", "tokushoho", "terms", "privacy"];

export const BASE = "https://sukizero.com";
/** CSS の版。トップページの style.css?v= に合わせる（build.py と同じ） */
export const CSS_VER = /style\.css\?v=([^"]+)/.exec(PAGES.index)![1];
/** 固定ページの最終更新日（サイトマップ用）。固定ページを直したら上げる */
export const FIXED_LASTMOD = "2026-11-11";

export interface Post {
	id: string;
	slug: string;
	status: string;
	num: string;
	title: string;
	date: string;
	modified?: string;
	cat: string;
	description: string;
	eyecatch: string;
	eyecatch_alt: string;
	toc: Record<string, string>;
	body_html: string;
}

/** 日本時間の今日（YYYY-MM-DD）。公開日がこの日以前の記事を公開する */
export function todayJST(): string {
	return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function toPost(e: { id: string; data: Record<string, unknown> }, status: string): Post {
	const d = e.data as Record<string, any>;
	let toc = d.toc ?? {};
	if (typeof toc === "string") {
		try {
			toc = JSON.parse(toc);
		} catch {
			toc = {};
		}
	}
	return {
		id: e.id,
		slug: String(d.slug ?? d.id ?? ""),
		status,
		num: String(d.num ?? ""),
		title: String(d.title ?? ""),
		date: String(d.date ?? ""),
		modified: d.modified ? String(d.modified) : undefined,
		cat: String(d.cat ?? ""),
		description: String(d.description ?? ""),
		eyecatch: String(d.eyecatch ?? ""),
		eyecatch_alt: String(d.eyecatch_alt ?? ""),
		toc,
		body_html: String(d.body_html ?? ""),
	};
}

/** 記事が公開中か：公開状態・公開日が今日以前・本文あり */
export function isLive(p: Post, today = todayJST()): boolean {
	return p.status === "published" && !!p.date && p.date <= today && p.body_html.trim() !== "";
}

const byNewest = (a: Post, b: Post) => (a.date === b.date ? (a.num < b.num ? 1 : -1) : a.date < b.date ? 1 : -1);

export async function allPosts(): Promise<Post[]> {
	const [pub, draft] = await Promise.all([
		getEmDashCollection("posts", { status: "published", limit: 1000 }),
		getEmDashCollection("posts", { status: "draft", limit: 1000 }),
	]);
	const seen = new Set<string>();
	const out: Post[] = [];
	for (const e of pub.entries) {
		seen.add(e.id);
		out.push(toPost(e as any, "published"));
	}
	for (const e of draft.entries) if (!seen.has(e.id)) out.push(toPost(e as any, "draft"));
	return out;
}

export async function livePost(slug: string): Promise<Post | null> {
	const { entry } = await getEmDashEntry("posts", slug);
	if (!entry) return null;
	const p = toPost(entry as any, "published");
	if (!p.slug) p.slug = slug;
	return isLive(p) ? p : null;
}

/** Python の html.escape と同じ */
export function esc(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#x27;");
}

/** Python の json.dumps(x, ensure_ascii=False) と同じ形（区切りは ", " と ": "） */
export function pyJson(x: unknown): string {
	if (x === null || x === undefined) return "null";
	if (Array.isArray(x)) return "[" + x.map(pyJson).join(", ") + "]";
	if (typeof x === "object")
		return "{" + Object.entries(x as Record<string, unknown>).map(([k, v]) => JSON.stringify(k) + ": " + pyJson(v)).join(", ") + "}";
	return JSON.stringify(x);
}

const WD = ["日", "月", "火", "水", "木", "金", "土"];

function cardImg(src: string) {
	return `<div class="post-thumb has-img"><img src="${src}" alt="" width="1200" height="630" loading="lazy"></div>`;
}
const t = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 記事カード。prefix はページの位置からの相対（ブログ一覧は "../blog/" と "img/"、トップは "blog/" と "blog/img/"） */
export function card(p: Post, href: string, img: string): string {
	return `<a class="post-card" href="${href}${p.slug}.html" data-cat="${p.cat}">${cardImg(img + p.eyecatch)}<div class="post-body"><div class="post-meta"><span class="post-cat">${p.cat}</span><time>${p.date.replace(/-/g, ".")}</time></div><h3>${t(p.title)}</h3></div></a>`;
}

export function soonCard(p: Post, img: string): string {
	const [y, m, d] = p.date.split("-").map(Number);
	const w = WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
	return `<div class="post-card soon" data-cat="${p.cat}">${cardImg(img + p.eyecatch)}<div class="post-body"><div class="post-meta"><span class="post-cat">${p.cat}</span><span>${m}月${d}日（${w}）公開予定</span></div><h3>${t(p.title)}</h3></div></div>`;
}

export async function blogCards(where: "blog" | "home"): Promise<string> {
	const today = todayJST();
	const posts = await allPosts();
	const live = posts.filter((p) => isLive(p, today)).sort(byNewest);
	if (where === "home") return live.slice(0, 3).map((p) => card(p, "blog/", "blog/img/")).join("");
	const soon = posts
		.filter((p) => p.date && p.date > today)
		.sort((a, b) => (a.date === b.date ? (a.num > b.num ? 1 : -1) : a.date > b.date ? 1 : -1));
	return live.map((p) => card(p, "../blog/", "img/")).join("") + soon.map((p) => soonCard(p, "img/")).join("");
}

/** h1 を「｜」（無ければ途中の「？」の後）で主題と副題の2段に分ける（build.py と同じ） */
function h1html(title: string): string {
	const s = esc(title);
	let a: string, c: string, sep: string;
	if (s.includes("｜")) {
		const i = s.indexOf("｜");
		[a, c, sep] = [s.slice(0, i), s.slice(i + 1), "｜"];
	} else if (s.slice(0, -1).includes("？")) {
		const i = s.indexOf("？");
		[a, c, sep] = [s.slice(0, i + 1), s.slice(i + 1), ""];
	} else return s;
	return `<span class="h1-main">${a}</span><span class="h1-sub" data-sep="${sep}">${c}</span>`;
}

const rep = (s: string, a: string, b: string) => s.split(a).join(b);

/** 記事ページの HTML（build.py と同じ結果） */
export function renderArticle(p: Post): string {
	const toc: [string, string][] = [];
	let body = p.body_html.replace(/<h2>(.*?)<\/h2>/g, (_m, g1) => {
		const id = `s${toc.length + 1}`;
		toc.push([id, g1]);
		return `<h2 id="${id}">${g1}</h2>`;
	});
	body = rep(body, "<figure><img ", '<figure class="fig"><img loading="lazy" decoding="async" ');
	const tocHtml = toc.map(([i, h]) => `<li><a href="#${i}">${p.toc[h] ?? h}</a></li>`).join("");
	const faq: unknown[] = [];
	const m = /<h2 id="s\d+">[^<]*よくある質問<\/h2>([\s\S]*?)(?=<h2)/.exec(body);
	if (m) {
		for (const q of m[1].matchAll(/<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g))
			faq.push({ "@type": "Question", name: q[1], acceptedAnswer: { "@type": "Answer", text: q[2].replace(/<[^>]+>/g, "") } });
	}
	const url = `${BASE}/blog/${p.slug}.html`;
	const ld: unknown[] = [
		{
			"@context": "https://schema.org",
			"@type": "BlogPosting",
			headline: p.title,
			description: p.description,
			image: `${BASE}/blog/img/${p.eyecatch}`,
			datePublished: p.date,
			dateModified: p.modified || p.date,
			author: { "@type": "Organization", name: "スキゼロ（インフォサクセス）", url: `${BASE}/about.html` },
			publisher: { "@type": "Organization", "@id": `${BASE}/#org`, name: "スキゼロ", url: `${BASE}/`, logo: { "@type": "ImageObject", url: `${BASE}/assets/logo.svg` } },
			mainEntityOfPage: url,
			inLanguage: "ja",
			articleSection: p.cat,
			isPartOf: { "@id": `${BASE}/#website` },
		},
	];
	if (faq.length) ld.push({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq });
	ld.push({
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: [
			{ "@type": "ListItem", position: 1, name: "トップ", item: `${BASE}/` },
			{ "@type": "ListItem", position: 2, name: "ブログ", item: `${BASE}/blog/index.html` },
			{ "@type": "ListItem", position: 3, name: p.title },
		],
	});
	let out = articleTpl;
	out = rep(out, "{{TITLE}}", esc(p.title));
	out = rep(out, "{{DESC}}", esc(p.description));
	out = rep(out, "{{URL}}", url);
	out = rep(out, "{{EYECATCH}}", p.eyecatch);
	out = rep(out, "{{EYECATCH_ALT}}", esc(p.eyecatch_alt));
	out = rep(out, "{{CAT}}", p.cat);
	out = rep(out, "{{DATE_DOT}}", p.date.replace(/-/g, "."));
	out = rep(out, "{{DATE}}", p.date);
	out = rep(out, "{{LD}}", pyJson(ld));
	out = rep(out, "{{TOC}}", tocHtml);
	out = rep(out, "{{BODY}}", body);
	out = rep(out, "{{BUILD}}", CSS_VER);
	return out.replace(`<h1>${esc(p.title)}</h1>`, `<h1>${h1html(p.title)}</h1>`);
}

/** Vercel版と同じセキュリティヘッダー（vercel.json の headers）。CSP だけ、Cloudflare が自動で足すアクセス解析（Web Analytics）のタグを許す */
export const SECURITY_HEADERS: Record<string, string> = {
	"Strict-Transport-Security": "max-age=31536000; includeSubDomains",
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options": "DENY",
	"Referrer-Policy": "strict-origin-when-cross-origin",
	"Permissions-Policy": "camera=(), microphone=(), geolocation=()",
	"Content-Security-Policy":
		"default-src 'self'; script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://cloudflareinsights.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

export function htmlResponse(body: string, status = 200, host?: string): Response {
	const headers: Record<string, string> = { "content-type": "text/html; charset=utf-8", ...SECURITY_HEADERS };
	// sukizero.com 以外（workers.dev など）では検索に載せない
	if (host && host !== "sukizero.com") headers["X-Robots-Tag"] = "noindex, nofollow";
	return new Response(body, { status, headers });
}

export function notFound(host?: string): Response {
	return htmlResponse(PAGES["404"], 404, host);
}

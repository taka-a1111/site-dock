import type { APIRoute } from "astro";
import { FIXED, PAGES, blogCards, htmlResponse, notFound } from "../lib/sukizero";

/** /<名前>.html の固定ページ（/index.html はトップと同じ） */
export const GET: APIRoute = async ({ params, url }) => {
	const m = /^([a-z0-9-]+)\.html$/.exec(params.page ?? "");
	if (!m) return notFound(url.hostname);
	const name = m[1];
	if (name === "index") return htmlResponse(PAGES.index.replace("{{CARDS}}", await blogCards("home")), 200, url.hostname);
	if (name === "404") return htmlResponse(PAGES["404"], 200, url.hostname);
	if (!FIXED.includes(name)) return notFound(url.hostname);
	return htmlResponse(PAGES[name], 200, url.hostname);
};

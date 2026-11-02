import type { APIRoute } from "astro";
import { PAGES, blogCards, htmlResponse, livePost, notFound, renderArticle } from "../../lib/sukizero";

/** /blog/index.html と /blog/<slug>.html */
export const GET: APIRoute = async ({ params, url }) => {
	const m = /^([a-z0-9-]+)\.html$/.exec(params.file ?? "");
	if (!m) return notFound(url.hostname);
	if (m[1] === "index") return htmlResponse(PAGES["blog-index"].replace("{{CARDS}}", await blogCards("blog")), 200, url.hostname);
	const post = await livePost(m[1]);
	if (!post) return notFound(url.hostname);
	return htmlResponse(renderArticle(post), 200, url.hostname);
};

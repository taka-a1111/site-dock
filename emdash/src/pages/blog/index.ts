import type { APIRoute } from "astro";
import { PAGES, blogCards, htmlResponse } from "../../lib/sukizero";

export const GET: APIRoute = async ({ url }) =>
	htmlResponse(PAGES["blog-index"].replace("{{CARDS}}", await blogCards("blog")), 200, url.hostname);

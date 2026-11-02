import type { APIRoute } from "astro";
// @ts-ignore
import { runScan, normalize, checkHost, hits, cache, CACHE_MS, RATE_WINDOW, RATE_MAX } from "../../server/scan.js";

/** 無料簡易診断（Vercel版 api/scan.js と同じ応答） */
export const GET: APIRoute = async ({ request, url }) => {
	const json = (status: number, body: unknown) =>
		new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
	const host = normalize(url.searchParams.get("url") || url.searchParams.get("domain") || "");
	if (!host) return json(400, { error: "invalid", message: "URLの形が正しくありません。example.com のように入れてください。" });
	const ip = request.headers.get("cf-connecting-ip") || "unknown";
	const now = Date.now();
	const list = (hits.get(ip) || []).filter((t: number) => now - t < RATE_WINDOW);
	const c = cache.get(host);
	if (c && now - c.t < CACHE_MS) return json(200, c.data);
	if (list.length >= RATE_MAX) return json(429, { error: "rate", message: "短い時間に診断が続いたため、少し待ってからお試しください。" });
	list.push(now);
	hits.set(ip, list);
	if (!(await checkHost(host))) return json(400, { error: "dns", message: "このURLのサイトが見つかりませんでした。綴りを確かめてください。" });
	try {
		const data = await runScan(host);
		if (data.error) return json(502, { error: data.error, message: "サイトに接続できませんでした。URLを確かめるか、少し待ってからお試しください。" });
		delete data.detail; // 詳しい内容は画面に出さない
		cache.set(host, { t: now, data });
		return json(200, data);
	} catch (e) {
		console.error("scan", e);
		return json(500, { error: "internal", message: "診断中にエラーが起きました。少し待ってからお試しください。" });
	}
};

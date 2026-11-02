import type { APIRoute } from "astro";
// @ts-ignore
import { total } from "../../server/nvd.js";

/** NVD の登録件数（1日キャッシュ） */
export const GET: APIRoute = async () => {
	try {
		const t = await total();
		return new Response(JSON.stringify({ nvdTotal: t.total, asOf: t.asOf }), {
			headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, s-maxage=86400, stale-while-revalidate=604800" },
		});
	} catch {
		return new Response(JSON.stringify({ error: "nvd" }), { status: 502, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
	}
};

import handler, { createScheduledHandler, PluginBridge } from "@emdash-cms/cloudflare/worker";
import { runFollowups } from "./server/followup.js";

const emdashScheduled = createScheduledHandler();

export { PluginBridge };

/** 管理画面（/_emdash）を開けるホスト。仮URL（workers.dev）などでは管理画面と初期設定を出さない */
const ADMIN_HOSTS = new Set(["sukizero.com", "localhost", "127.0.0.1"]);
/** sukizero.com へ308で送るホスト（旧名の site-dock.com と www）。Vercel版の vercel.json の redirects と同じ */
const MOVED = new Set(["www.sukizero.com", "site-dock.com", "www.site-dock.com", "site-dock-orcin.vercel.app"]);

export default {
	...handler,
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);
		if (MOVED.has(url.hostname)) return Response.redirect(`https://sukizero.com${url.pathname}${url.search}`, 308);
		if (url.pathname.startsWith("/_emdash") && !ADMIN_HOSTS.has(url.hostname)) {
			return new Response("Not Found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" } });
		}
		return handler.fetch!(request as any, env as any, ctx);
	},
	async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
		// 毎分：EmDash の予約処理。1時間に1回（7分）：結果票のあとの案内メール
		const pe = (globalThis as any).process?.env;
		if (pe) for (const [k, v] of Object.entries(env as any)) if (typeof v === "string" && !pe[k]) pe[k] = v;
		if (new Date(controller.scheduledTime).getUTCMinutes() === 7) ctx.waitUntil(runFollowups().catch((e) => console.error("followup", e)));
		return (emdashScheduled as any)(controller, env, ctx);
	},
} satisfies ExportedHandler<Env>;

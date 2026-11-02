// NVD（米国の脆弱性データベース）との照合
// PHP・WordPress本体・プラグインの版を CPE で問い合わせ、既知の弱点（CVE）の件数と番号を返す。
// API キー（環境変数 NVD_API_KEY）があれば 30秒に50回、なければ 30秒に5回まで。

const API = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
// Worker では環境変数が読めるのはリクエストの中だけなので、毎回読む
const keyOf = () => (globalThis.process && process.env && process.env.NVD_API_KEY) || '';
const gapOf = () => (keyOf() ? 700 : 6500); // 問い合わせの間隔（ミリ秒）
const TTL = 24 * 60 * 60 * 1000;
const cache = new Map();
let last = 0;
let queue = Promise.resolve();

function slot() {
  // 問い合わせを1本ずつ、間隔を空けて流す
  const p = queue.then(async () => {
    const wait = last + gapOf() - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    last = Date.now();
  });
  queue = p.catch(() => {});
  return p;
}

async function call(params, timeout = 15000) {
  const qs = Object.entries(params).map(([k, v]) => v === true ? k : `${k}=${encodeURIComponent(v)}`).join('&');
  const url = `${API}?${qs}`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.t < TTL) return hit.data;
  await slot();
  const res = await fetch(url, { headers: keyOf() ? { apiKey: keyOf() } : {}, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`nvd ${res.status}`);
  const data = await res.json();
  cache.set(url, { t: Date.now(), data });
  return data;
}

function score(v) {
  const m = (v.cve && v.cve.metrics) || {};
  for (const k of ['cvssMetricV40', 'cvssMetricV31', 'cvssMetricV30', 'cvssMetricV2']) {
    if (m[k] && m[k][0] && m[k][0].cvssData) return m[k][0].cvssData.baseScore || 0;
  }
  return 0;
}

function cleanVer(v) {
  const m = String(v || '').match(/^\d+(?:\.\d+){0,3}/);
  return m ? m[0] : null;
}

// CPE の名前に使えない文字を除く（プラグインのフォルダ名 contact-form-7 → contact_form_7）
const cpeName = s => String(s).toLowerCase().replace(/[^a-z0-9_.]+/g, '_');

async function match(cpe) {
  const d = await call({ noRejected: true, resultsPerPage: 2000, virtualMatchString: cpe });
  const list = (d.vulnerabilities || []).map(v => ({ id: v.cve.id, score: score(v) }))
    .sort((a, b) => b.score - a.score || (a.id < b.id ? 1 : -1));
  return {
    count: d.totalResults || list.length,
    critical: list.filter(x => x.score >= 9).length,
    high: list.filter(x => x.score >= 7 && x.score < 9).length,
    top: list.slice(0, 5),
  };
}

function cmpVer(a, b) {
  const x = String(a).split('.').map(n => parseInt(n, 10) || 0), y = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
  return 0;
}

// 1件の CVE が、そのプラグインのその版に当てはまるか
// 先に NVD の構成情報（CPE と版の範囲）を見て、なければ説明文の「up to, and including, X」などを読む
function affects(cve, product, ver) {
  let sawCpe = false;
  for (const conf of cve.configurations || []) for (const node of conf.nodes || []) for (const m of node.cpeMatch || []) {
    const p = String(m.criteria || '').split(':');
    if (p[4] !== product || p[9] !== 'wordpress' || !m.vulnerable) continue;
    sawCpe = true;
    if (p[5] && p[5] !== '*' && p[5] !== '-') { if (cmpVer(ver, p[5]) === 0) return true; continue; }
    if (m.versionStartIncluding && cmpVer(ver, m.versionStartIncluding) < 0) continue;
    if (m.versionStartExcluding && cmpVer(ver, m.versionStartExcluding) <= 0) continue;
    if (m.versionEndIncluding && cmpVer(ver, m.versionEndIncluding) > 0) continue;
    if (m.versionEndExcluding && cmpVer(ver, m.versionEndExcluding) >= 0) continue;
    return true;
  }
  if (sawCpe) return false;
  const desc = ((cve.descriptions || []).find(x => x.lang === 'en') || {}).value || '';
  let m = desc.match(/(?:up to,? and including,?|through|<=)\s*v?(\d+(?:\.\d+)*)/i) || desc.match(/v?(\d+(?:\.\d+)*) and (?:earlier|below|prior)/i);
  if (m) return cmpVer(ver, m[1]) <= 0;
  m = desc.match(/(?:before|prior to|<)\s*v?(\d+(?:\.\d+)*)/i);
  if (m) return cmpVer(ver, m[1]) < 0;
  return false;
}

// プラグインは NVD の構成情報が付いていない CVE が多いので、名前で探し、
// 参照先の URL にフォルダ名が入っているもの（wordpress.org、Wordfence、Patchstack など）だけを数える
async function matchPlugin(slug, ver) {
  const d = await call({ noRejected: true, resultsPerPage: 2000, keywordSearch: slug.replace(/[-_]+/g, ' ') });
  const product = cpeName(slug);
  const esc = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ref = new RegExp(`(?:wordpress\\.org/plugins/|/browser/|plugins\\.svn\\.wordpress\\.org/|wordpress-plugins/|patchstack\\.com/database/(?:wordpress/plugin/|vulnerability/))${esc}(?:/|$|[?#])`, 'i');
  const mine = (d.vulnerabilities || []).filter(v => (v.cve.references || []).some(r => ref.test(r.url)) ||
    (v.cve.configurations || []).some(c => (c.nodes || []).some(n => (n.cpeMatch || []).some(m => { const p = String(m.criteria).split(':'); return p[4] === product && p[9] === 'wordpress'; }))));
  const hit = new Map(mine.filter(v => affects(v.cve, product, ver)).map(v => [v.cve.id, v]));
  // 構成情報（CPE）で登録されている分も足す
  try {
    const c = await call({ noRejected: true, resultsPerPage: 2000, virtualMatchString: `cpe:2.3:a:*:${product}:${ver}:*:*:*:*:wordpress:*:*` });
    (c.vulnerabilities || []).forEach(v => hit.set(v.cve.id, v));
    if (c.totalResults) mine.push(...c.vulnerabilities);
  } catch (e) { /* 名前で探した分だけで続ける */ }
  const list = [...hit.values()].map(v => ({ id: v.cve.id, score: score(v) }))
    .sort((a, b) => b.score - a.score || (a.id < b.id ? 1 : -1));
  return {
    known: mine.length > 0, // NVD にこのプラグインの登録があるか（なければ「照合できず」）
    count: list.length,
    critical: list.filter(x => x.score >= 9).length,
    high: list.filter(x => x.score >= 7 && x.score < 9).length,
    top: list.slice(0, 5),
  };
}

// detail（runScan の結果）から、照合できるものを問い合わせる
// budget：使ってよい時間（ミリ秒）。超えたら残りは照合しない（partial: true）
async function lookup(detail, { budget = 40000, pluginsMax = 12 } = {}) {
  const start = Date.now();
  const out = { checkedAt: new Date().toISOString(), source: 'NVD', partial: false };
  const jobs = [];
  const php = cleanVer(detail.php && detail.php.version);
  if (php) jobs.push(['php', null, `cpe:2.3:a:php:php:${php}:*:*:*:*:*:*:*`]);
  const core = cleanVer(detail.core && detail.core.version);
  if (core) jobs.push(['core', null, `cpe:2.3:a:wordpress:wordpress:${core}:*:*:*:*:*:*:*`]);
  const pl = (detail.plugins && detail.plugins.list) || [];
  pl.filter(p => p.have && cleanVer(p.have) && p.state !== 'unknown').slice(0, pluginsMax).forEach(p => {
    jobs.push(['plugin', p.slug, cleanVer(p.have)]);
  });
  out.plugins = [];
  for (const [kind, slug, cpe] of jobs) {
    if (Date.now() - start + gapOf() > budget) { out.partial = true; break; }
    try {
      if (kind === 'plugin') { out.plugins.push({ slug, ...(await matchPlugin(slug, cpe)) }); continue; }
      const r = await match(cpe);
      out[kind] = r;
    } catch (e) {
      out.partial = true;
      if (/abort|timeout/i.test(String(e && e.name || e))) break;
    }
  }
  return out;
}

// NVD の登録件数（トップの「◯万件」の表記に使う）
async function total() {
  const d = await call({ resultsPerPage: 1 }, 10000);
  return { total: d.totalResults, asOf: d.timestamp };
}

export { lookup, total, match, matchPlugin, affects, cpeName, cleanVer };
export const hasKey = () => !!keyOf();

// サイトドック 無料簡易診断 API
// 非侵入型：ふつうの閲覧と同じ GET だけで、公開されている情報を読む。
// 書き込み・ログインの試行・総当たりはしない。

const dns = require('node:dns').promises;
const net = require('node:net');
const tls = require('node:tls');

const UA = 'SiteDockBot/1.0 (+https://site-dock.com/service.html)';
const MAX_BODY = 700 * 1024;
const cache = new Map();   // domain -> {t, data}
const hits = new Map();    // ip -> [timestamps]
const CACHE_MS = 10 * 60 * 1000;
const RATE_WINDOW = 10 * 60 * 1000;
const RATE_MAX = 12;

// PHP のサポート期限（php.net Supported Versions）[通常サポート終了, セキュリティサポート終了]
const PHP_EOL = {
  '7.4': ['2021-11-28', '2022-11-28'],
  '8.0': ['2022-11-26', '2023-11-26'],
  '8.1': ['2023-11-25', '2025-12-31'],
  '8.2': ['2024-12-31', '2026-12-31'],
  '8.3': ['2025-12-31', '2027-12-31'],
  '8.4': ['2026-12-31', '2028-12-31'],
  '8.5': ['2027-12-31', '2029-12-31'],
};

// ---------- 入力の確認と、内部ネットワークへのアクセス防止 ----------
function normalize(input) {
  let v = String(input || '').trim();
  if (!v || v.length > 300) return null;
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  let u;
  try { u = new URL(v); } catch (e) { return null; }
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (u.port && u.port !== '80' && u.port !== '443') return null;
  if (!host.includes('.') || net.isIP(host) || host === 'localhost' || /\.(local|internal|localhost|test|invalid|example)$/.test(host)) return null;
  if (!/^[a-z0-9.-]+$/.test(host) || host.length > 253) return null;
  return host;
}

function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    return p[0] === 0 || p[0] === 10 || p[0] === 127 || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
      (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) || (p[0] === 192 && p[1] === 0) || (p[0] === 198 && (p[1] === 18 || p[1] === 19)) || p[0] >= 224;
  }
  const s = ip.toLowerCase();
  if (s === '::' || s === '::1') return true;
  if (s.startsWith('::ffff:')) return isPrivate(s.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(s);
}

const hostOk = new Map();
async function checkHost(host) {
  if (hostOk.has(host)) return hostOk.get(host);
  let ok = false;
  try {
    const addrs = await dns.lookup(host, { all: true });
    ok = addrs.length > 0 && addrs.every(a => !isPrivate(a.address));
  } catch (e) { ok = false; }
  hostOk.set(host, ok);
  return ok;
}

// ---------- 取得 ----------
async function get(url, { follow = true, max = MAX_BODY, timeout = 7000 } = {}) {
  let cur = url;
  for (let hop = 0; hop < 5; hop++) {
    const u = new URL(cur);
    if (!['http:', 'https:'].includes(u.protocol) || (u.port && u.port !== '80' && u.port !== '443')) return { error: 'blocked' };
    if (!(await checkHost(u.hostname))) return { error: 'blocked' };
    let res;
    try {
      res = await fetch(cur, { redirect: 'manual', headers: { 'user-agent': UA, accept: 'text/html,application/json;q=0.9,*/*;q=0.5' }, signal: AbortSignal.timeout(timeout) });
    } catch (e) {
      return { error: e && e.name === 'TimeoutError' ? 'timeout' : 'fetch', detail: String(e && e.cause && e.cause.code || e.message || e) };
    }
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      if (!follow) { try { await res.body?.cancel(); } catch (e) {} return { status: res.status, headers: res.headers, location: new URL(loc, cur).href, url: cur, body: '' }; }
      try { await res.body?.cancel(); } catch (e) {}
      cur = new URL(loc, cur).href;
      continue;
    }
    const body = await readLimited(res, max);
    return { status: res.status, headers: res.headers, url: cur, body };
  }
  return { error: 'redirects' };
}

async function readLimited(res, max) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (size < max) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); size += value.length;
    }
  } catch (e) { /* 途中で切れても読めた分を使う */ }
  try { await reader.cancel(); } catch (e) {}
  return Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8');
}

function certInfo(host) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    const sock = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: 6000 }, () => {
      const c = sock.getPeerCertificate();
      const authorized = sock.authorized;
      const err = sock.authorizationError ? String(sock.authorizationError) : '';
      sock.end();
      if (!c || !c.valid_to) return finish({ error: 'nocert' });
      finish({ authorized, err, validTo: new Date(c.valid_to) });
    });
    sock.on('timeout', () => { sock.destroy(); finish({ error: 'timeout' }); });
    sock.on('error', e => finish({ error: e.code || 'error' }));
  });
}

// なりすましメール対策：ドメインの公開情報（DNSのTXT記録）を読むだけ
// DNS は公開の DNS-over-HTTPS で引く（実行環境の DNS に左右されないように）
const DOH = ['https://cloudflare-dns.com/dns-query', 'https://dns.google/resolve'];
async function txt(name) {
  for (const base of DOH) {
    try {
      const res = await fetch(`${base}?name=${encodeURIComponent(name)}&type=TXT`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(4000) });
      if (!res.ok) continue;
      const j = await res.json();
      if (j.Status === 3) return [];            // そのドメインに記録なし
      if (j.Status !== 0) continue;
      return (j.Answer || []).filter(a => a.type === 16).map(a => String(a.data).replace(/^"|"$/g, '').replace(/"\s*"/g, ''));
    } catch (e) { /* 次の問い合わせ先へ */ }
  }
  return null;                                   // 確認できず
}
async function mailCheck(host) {
  const base = host.replace(/^www\./, '');
  // DMARC はサブドメインに無ければ、親のドメイン（example.co.jp など）の記録が使われる
  const lb = base.split('.');
  const orgLen = lb.length >= 3 && lb[lb.length - 1] === 'jp' && /^(co|or|ne|ac|go|ed|lg|gr|ad)$/.test(lb[lb.length - 2]) ? 3 : 2;
  const org = lb.slice(-orgLen).join('.');
  const [root, dm0] = await Promise.all([txt(base), txt('_dmarc.' + base)]);
  let dm = dm0;
  if (dm && !dm.some(t => /^v=DMARC1/i.test(t.trim())) && org !== base) dm = await txt('_dmarc.' + org);
  if (root === null || dm === null) return { error: true };
  const spf = root.find(t => /^v=spf1(\s|$)/i.test(t.trim()));
  const dmarc = dm.find(t => /^v=DMARC1\s*;/i.test(t.trim()));
  const policy = dmarc ? ((dmarc.match(/(?:^|;)\s*p\s*=\s*(\w+)/i) || [])[1] || '').toLowerCase() : '';
  return { spf: !!spf, dmarc: !!dmarc, policy, spfRecord: spf || '', dmarcRecord: dmarc || '', org };
}

// ---------- 判定の部品 ----------
const ORDER = { A: 1, B: 2, C: 3, D: 4, E: 5 };
// 画面と結果票に出す名前［一般の言葉, 専門の名前］
const NAMES = {
  ssl: ['通信ののぞき見', 'SSL証明書'],
  php: ['土台のプログラム', 'PHP'],
  core: ['本体の更新漏れ', 'WordPress本体'],
  plugins: ['危ない追加機能', 'プラグイン'],
  users: ['ログイン名の丸見え', 'ユーザー名'],
  files: ['見えてはいけないファイル', '不要なファイル'],
  headers: ['守りの設定の抜け', 'セキュリティ設定'],
  mail: ['なりすましメール', 'SPF・DMARC'],
};
const worst = gs => gs.filter(g => ORDER[g]).sort((a, b) => ORDER[b] - ORDER[a])[0] || 'A';
const cmpVer = (a, b) => {
  const pa = String(a).split(/[.-]/).map(n => parseInt(n, 10) || 0), pb = String(b).split(/[.-]/).map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
};
const days = d => Math.floor((d - Date.now()) / 86400000);

function gradePhp(ver) {
  const m = String(ver).match(/^(\d+)\.(\d+)/);
  if (!m) return null;
  const branch = m[1] + '.' + m[2];
  const major = parseInt(m[1], 10), minor = parseInt(m[2], 10);
  const now = Date.now();
  if (major < 7 || (major === 7 && minor < 4)) return { grade: 'E', value: `${branch}（サポート終了から数年）` };
  const eol = PHP_EOL[branch];
  if (!eol) return { grade: 'A', value: `${branch}（サポート中）` };
  const active = new Date(eol[0] + 'T23:59:59+09:00'), sec = new Date(eol[1] + 'T23:59:59+09:00');
  if (now > sec) {
    const ago = (now - sec) / 86400000;
    return { grade: ago > 365 ? 'E' : 'D', value: `${branch}（サポート終了）` };
  }
  if (now > active) {
    const left = (sec - now) / 86400000;
    const y = sec.getFullYear(), mo = sec.getMonth() + 1;
    return left < 183 ? { grade: 'C', value: `${branch}（${y}年${mo}月でサポート終了）` } : { grade: 'B', value: `${branch}（セキュリティ修正のみ）` };
  }
  return { grade: 'A', value: `${branch}（サポート中）` };
}

async function latestCore() {
  const r = await get('https://api.wordpress.org/core/version-check/1.7/', { timeout: 5000 });
  try { return JSON.parse(r.body).offers[0].current; } catch (e) { return null; }
}

async function pluginLatest(slug) {
  const url = `https://api.wordpress.org/plugins/info/1.2/?action=plugin_information&request[slug]=${encodeURIComponent(slug)}&request[fields][sections]=0&request[fields][description]=0&request[fields][reviews]=0&request[fields][screenshots]=0&request[fields][banners]=0&request[fields][icons]=0`;
  const r = await get(url, { timeout: 5000, max: 200 * 1024 });
  try {
    const j = JSON.parse(r.body);
    if (j.error) return { closed: /closed/i.test(j.error), missing: !/closed/i.test(j.error) };
    return { version: j.version };
  } catch (e) { return { unknown: true }; }
}

function findWpVersion(html) {
  let m = html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']WordPress\s+([0-9.]+)/i) || html.match(/content=["']WordPress\s+([0-9.]+)["'][^>]*name=["']generator/i);
  if (m) return m[1];
  const vers = {};
  // jQuery など同梱ライブラリの版を拾わないよう、本体の版が付くファイルだけを見る
  const re = /\/wp-includes\/(?:css\/[^"'\s>]+|js\/(?:wp-emoji[^"'\s>]*|dist\/[^"'\s>]+|comment-reply[^"'\s>]*|wp-embed[^"'\s>]*))\?ver=([0-9]+\.[0-9]+(?:\.[0-9]+)?)(?=["'&\s>])/gi;
  let x; while ((x = re.exec(html))) { if (parseInt(x[1], 10) >= 4) vers[x[1]] = (vers[x[1]] || 0) + 1; }
  const best = Object.entries(vers).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}

function findPlugins(html) {
  const out = {};
  const re = /\/wp-content\/plugins\/([a-z0-9][a-z0-9_-]{1,80})\/[^"'\s>]*/gi;
  let m;
  while ((m = re.exec(html))) {
    const slug = m[1].toLowerCase();
    const v = (m[0].match(/[?&]ver=([0-9]+(?:\.[0-9]+){0,3})/) || [])[1];
    if (!out[slug]) out[slug] = {};
    if (v) out[slug][v] = (out[slug][v] || 0) + 1;
  }
  return Object.entries(out).map(([slug, vs]) => {
    const best = Object.entries(vs).sort((a, b) => b[1] - a[1])[0];
    return { slug, version: best ? best[0] : null };
  });
}

// ---------- 診断本体 ----------
async function runScan(host) {
  const startUrl = `https://${host}/`;
  let home = await get(startUrl);
  let https = true;
  if (home.error || !home.status) {
    const plain = await get(`http://${host}/`);
    if (plain.error || !plain.status) return { error: 'unreachable' };
    home = plain; https = home.url.startsWith('https://');
  }
  const finalUrl = new URL(home.url);
  const origin = finalUrl.origin;
  const finalHost = finalUrl.hostname;
  const html = home.body || '';
  const h = home.headers;

  const isWp = /\/wp-content\/|\/wp-includes\/|<meta[^>]+generator[^>]+WordPress|\/wp-json\//i.test(html) || /wp-json/.test(h.get('link') || '');

  // 並列で取得
  const tasks = {
    cert: finalUrl.protocol === 'https:' ? certInfo(finalHost) : Promise.resolve({ error: 'nohttps' }),
    httpRedirect: get(`http://${finalHost}/`, { follow: false, max: 1024, timeout: 5000 }),
    mail: mailCheck(host),
  };
  if (isWp) {
    Object.assign(tasks, {
      users: get(`${origin}/wp-json/wp/v2/users?per_page=5`, { max: 100 * 1024, timeout: 6000 }),
      author: get(`${origin}/?author=1`, { follow: false, max: 1024, timeout: 6000 }),
      readme: get(`${origin}/readme.html`, { max: 20 * 1024, timeout: 6000 }),
      uploads: get(`${origin}/wp-content/uploads/`, { max: 20 * 1024, timeout: 6000 }),
      login: get(`${origin}/wp-login.php`, { follow: false, max: 4 * 1024, timeout: 6000 }),
      latest: latestCore(),
    });
  }
  const keys = Object.keys(tasks);
  const vals = await Promise.all(Object.values(tasks).map(p => p.catch(e => ({ error: String(e) }))));
  const r = {}; keys.forEach((k, i) => { r[k] = vals[i]; });

  const rows = [];
  // 結果票（持ち主にだけ送る）に載せる詳しい内容。画面の API では返さない
  const detail = { https, wordpress: isWp };

  // 1. SSL証明書
  if (!https || r.cert.error === 'nohttps') {
    rows.push({ key: 'ssl', label: 'SSL証明書', value: 'HTTPSで開けない', grade: 'E' });
  } else if (r.cert.error) {
    rows.push({ key: 'ssl', label: 'SSL証明書', value: '確認できず', grade: '-' });
  } else {
    const d = days(r.cert.validTo);
    detail.cert = { validTo: r.cert.validTo.toISOString(), daysLeft: d, authorized: r.cert.authorized };
    if (!r.cert.authorized) rows.push({ key: 'ssl', label: 'SSL証明書', value: d < 0 ? '期限切れ' : '証明書にエラー', grade: 'E' });
    else if (d < 0) rows.push({ key: 'ssl', label: 'SSL証明書', value: '期限切れ', grade: 'E' });
    else if (d < 7) rows.push({ key: 'ssl', label: 'SSL証明書', value: `残り${d}日`, grade: 'D' });
    else if (d < 14) rows.push({ key: 'ssl', label: 'SSL証明書', value: `有効（残り${d}日）`, grade: 'C' });
    else rows.push({ key: 'ssl', label: 'SSL証明書', value: `有効（残り${d}日）`, grade: 'A' });
  }

  // 2. PHP
  const powered = [h.get('x-powered-by'), r.login && r.login.headers && r.login.headers.get('x-powered-by')].filter(Boolean).join(' ');
  const pm = powered.match(/PHP\/([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i);
  detail.php = { version: pm ? pm[1] : null, exposed: !!pm };
  if (pm) {
    const g = gradePhp(pm[1]);
    rows.push({ key: 'php', label: 'PHP', value: g.value, grade: g.grade, exposed: true });
  } else {
    rows.push({ key: 'php', label: 'PHP', value: '版は外から見えない設定', grade: '-' });
  }

  // 3〜6. WordPress
  let pluginNames = [];
  if (isWp) {
    let ver = findWpVersion(html);
    if (!ver) {
      const feed = await get(`${origin}/feed/`, { max: 12 * 1024, timeout: 5000 }).catch(() => ({}));
      const fm = (feed.body || '').match(/<generator>https?:\/\/wordpress\.org\/\?v=([0-9.]+)<\/generator>/i);
      if (fm) ver = fm[1];
    }
    const latest = r.latest;
    detail.core = { version: ver || null, latest: latest || null };
    if (!ver) rows.push({ key: 'core', label: 'WordPress本体', value: '版は外から見えない設定', grade: '-' });
    else if (!latest) rows.push({ key: 'core', label: 'WordPress本体', value: `${ver}（最新版を確認できず）`, grade: '-' });
    else if (cmpVer(ver, latest) >= 0) rows.push({ key: 'core', label: 'WordPress本体', value: '最新版', grade: 'A' });
    else {
      const [a1, a2] = ver.split('.').map(Number), [b1, b2] = latest.split('.').map(Number);
      const behind = (b1 * 10 + (b2 || 0)) - (a1 * 10 + (a2 || 0));
      const g = behind <= 1 ? 'C' : behind <= 3 ? 'D' : 'E';
      rows.push({ key: 'core', label: 'WordPress本体', value: behind === 0 ? `${ver}（修正版が未適用）` : `${ver}（最新は${latest}）`, grade: g });
    }

    const plugins = findPlugins(html).slice(0, 12);
    detail.plugins = { found: plugins.length, list: [] };
    if (!plugins.length) {
      rows.push({ key: 'plugins', label: 'プラグイン', value: '外から確認できるものなし', grade: '-' });
    } else {
      const infos = await Promise.all(plugins.map(p => pluginLatest(p.slug).catch(() => ({ unknown: true }))));
      let old = 0, closed = 0, checked = 0;
      plugins.forEach((p, i) => {
        const inf = infos[i];
        detail.plugins.list.push({ slug: p.slug, have: p.version, latest: inf.version || null,
          state: inf.closed ? 'closed' : (!inf.version || !p.version || cmpVer(p.version, inf.version) > 0) ? 'unknown' : cmpVer(p.version, inf.version) < 0 ? 'old' : 'ok' });
        if (inf.closed) { closed++; checked++; pluginNames.push({ slug: p.slug, state: 'closed' }); return; }
        if (!inf.version || !p.version) return;
        if (cmpVer(p.version, inf.version) > 0) return; // ver= がプラグインの版ではない
        checked++;
        if (cmpVer(p.version, inf.version) < 0) { old++; pluginNames.push({ slug: p.slug, state: 'old', have: p.version, latest: inf.version }); }
      });
      const bad = old + closed;
      const g = bad === 0 ? 'A' : closed > 0 || bad >= 4 ? 'E' : bad >= 2 ? 'D' : 'C';
      let value;
      if (bad === 0) value = checked ? `確認できた${checked}件はすべて最新` : `${plugins.length}件（版は確認できず）`;
      else value = [old ? `更新が遅れているもの${old}件` : '', closed ? `配布停止${closed}件` : ''].filter(Boolean).join('・');
      rows.push({ key: 'plugins', label: 'プラグイン', value, grade: bad === 0 && !checked ? '-' : g });
    }

    let usersExposed = false;
    try {
      const j = JSON.parse(r.users.body || 'null');
      usersExposed = r.users.status === 200 && Array.isArray(j) && j.some(u => u && u.slug);
    } catch (e) {}
    const authorExposed = !!(r.author && r.author.location && /\/author\/[^/]+/i.test(r.author.location));
    detail.users = { rest: usersExposed, author: authorExposed };
    rows.push(usersExposed || authorExposed
      ? { key: 'users', label: 'ログイン名', value: '外から見える状態', grade: 'C' }
      : { key: 'users', label: 'ログイン名', value: '外から見えない', grade: 'A' });

    const readme = r.readme && r.readme.status === 200 && /WordPress/i.test(r.readme.body || '');
    const listing = r.uploads && r.uploads.status === 200 && /<title>\s*Index of/i.test(r.uploads.body || '');
    detail.files = { readme: !!readme, listing: !!listing };
    if (listing) rows.push({ key: 'files', label: '不要なファイル', value: readme ? 'ファイル一覧とreadmeが見える' : 'ファイル一覧が見える', grade: 'D' });
    else if (readme) rows.push({ key: 'files', label: '不要なファイル', value: 'readmeが残っている', grade: 'B' });
    else rows.push({ key: 'files', label: '不要なファイル', value: '見つからず', grade: 'A' });
  } else {
    rows.push({ key: 'core', label: 'WordPress本体', value: 'WordPress以外のサイト', grade: '-' });
    rows.push({ key: 'plugins', label: 'プラグイン', value: '対象外', grade: '-' });
    rows.push({ key: 'users', label: 'ログイン名', value: '対象外', grade: '-' });
    rows.push({ key: 'files', label: '不要なファイル', value: '対象外', grade: '-' });
  }

  // 7. セキュリティ設定（6項目）
  const hv = n => (h.get(n) || '').toLowerCase();
  const csp = hv('content-security-policy');
  const redir = r.httpRedirect && r.httpRedirect.location && r.httpRedirect.location.startsWith('https://');
  const items = [
    ['HTTPからHTTPSへの転送', !!redir],
    ['HSTS', !!hv('strict-transport-security')],
    ['MIMEタイプの固定', hv('x-content-type-options').includes('nosniff')],
    ['埋め込みの制限', !!hv('x-frame-options') || csp.includes('frame-ancestors')],
    ['CSP', !!csp],
    ['リファラーの制限', !!hv('referrer-policy')],
  ];
  const n = items.filter(i => i[1]).length;
  detail.headers = items.map(([name, ok]) => ({ name, ok }));
  const sg = n >= 5 ? 'A' : n === 4 ? 'B' : n >= 2 ? 'C' : n === 1 ? 'D' : 'E';
  rows.push({ key: 'headers', label: 'セキュリティ設定', value: `6項目中${n}項目`, grade: sg });

  // 8. なりすましメール（SPF・DMARC）
  const m = r.mail || { error: true };
  detail.mail = m;
  if (m.error) rows.push({ key: 'mail', label: 'メール', value: '確認できず', grade: '-' });
  else if (!m.spf && !m.dmarc) rows.push({ key: 'mail', label: 'メール', value: 'SPF・DMARCともに未設定', grade: 'D' });
  else if (!m.dmarc) rows.push({ key: 'mail', label: 'メール', value: 'DMARCが未設定', grade: 'C' });
  else if (!m.spf) rows.push({ key: 'mail', label: 'メール', value: 'SPFが未設定', grade: 'C' });
  else if (m.policy !== 'quarantine' && m.policy !== 'reject') rows.push({ key: 'mail', label: 'メール', value: 'DMARCが見張りだけ（p=none）', grade: 'B' });
  else rows.push({ key: 'mail', label: 'メール', value: 'SPF・DMARCとも設定あり', grade: 'A' });

  // 総合判定と、いちばん先にやること
  const order = ['ssl', 'plugins', 'php', 'core', 'files', 'users', 'mail', 'headers'];
  const w = worst(rows.map(x => x.grade));
  const overall = ORDER[w] >= 4 ? '要対策' : w === 'C' ? '要注意' : '良好';
  const ADV = {
    ssl: 'SSL証明書の状態を、早めに確かめることをおすすめします。',
    plugins: '更新が遅れているプラグインを、早めに更新することをおすすめします。',
    php: 'サポートが終わったPHPからの切り替えを、早めにおすすめします。',
    core: 'WordPress本体の更新を、早めにおすすめします。',
    files: '外から見えるファイル一覧や不要なファイルを、閉じることをおすすめします。',
    users: 'ログイン名が外から見えないようにする設定をおすすめします。',
    headers: 'サーバーのセキュリティ設定を足すことをおすすめします。',
    mail: '会社名をかたったメールを防ぐ設定（SPF・DMARC）を、ドメインに足すことをおすすめします。',
  };
  let advice = '大きな弱点は見つかりませんでした。定期的な点検で、この状態を保てます。';
  for (const g of ['E', 'D', 'C']) {
    const hit = order.find(k => (rows.find(x => x.key === k) || {}).grade === g);
    if (hit) { advice = ADV[hit]; break; }
  }

  rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  const display = ['ssl', 'php', 'core', 'plugins', 'users', 'files', 'headers', 'mail'];
  rows.sort((a, b) => display.indexOf(a.key) - display.indexOf(b.key));

  return {
    domain: host,
    finalUrl: finalUrl.href,
    wordpress: isWp,
    checkedAt: new Date().toISOString(),
    rows: rows.map(({ key, value, grade }) => ({ key, label: NAMES[key][0], tag: NAMES[key][1], value, grade })),
    overall: { grade: w, label: overall },
    advice,
    detail,
  };
}

module.exports = async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-type', 'application/json; charset=utf-8');
  const q = (req.query && (req.query.url || req.query.domain)) || '';
  const host = normalize(Array.isArray(q) ? q[0] : q);
  if (!host) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'invalid', message: 'URLの形が正しくありません。example.com のように入れてください。' })); }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW);

  const c = cache.get(host);
  if (c && now - c.t < CACHE_MS) { res.statusCode = 200; return res.end(JSON.stringify(c.data)); }

  if (list.length >= RATE_MAX) { res.statusCode = 429; return res.end(JSON.stringify({ error: 'rate', message: '短い時間に診断が続いたため、少し待ってからお試しください。' })); }
  list.push(now); hits.set(ip, list);

  if (!(await checkHost(host))) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'dns', message: 'このURLのサイトが見つかりませんでした。綴りを確かめてください。' })); }

  try {
    const data = await runScan(host);
    if (data.error) { res.statusCode = 502; return res.end(JSON.stringify({ error: data.error, message: 'サイトに接続できませんでした。URLを確かめるか、少し待ってからお試しください。' })); }
    delete data.detail; // 詳しい内容は画面に出さない
    cache.set(host, { t: now, data });
    res.statusCode = 200; res.end(JSON.stringify(data));
  } catch (e) {
    res.statusCode = 500; res.end(JSON.stringify({ error: 'internal', message: '診断中にエラーが起きました。少し待ってからお試しください。' }));
  }
};

module.exports.runScan = runScan;
module.exports.normalize = normalize;
module.exports.gradePhp = gradePhp;
module.exports.get = get;
module.exports.txt = txt;
module.exports.checkHost = checkHost;

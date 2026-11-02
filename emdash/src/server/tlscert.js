// サイトのSSL証明書の有効期限を読む（Cloudflare Workers 用）
// Workers からは証明書の中身を直接見られないので、TLS 1.2 のあいさつ（ClientHello）を自分で送り、
// サーバーが平文で返す証明書（Certificate メッセージ）の1枚目から有効期限（notAfter）を取り出す。
// 鍵の交換はしない（証明書を受け取った時点で切る）。TLS 1.3 にしか応じないサーバーや、
// Workers から直接つなげない宛先（Cloudflare 配下のサイトなど）は、証明書の公開ログ（crt.sh）で補う。
import { connect } from "cloudflare:sockets";

const SUITES = [0xc02f, 0xc02b, 0xc030, 0xc02c, 0xcca8, 0xcca9, 0xc013, 0xc014, 0xc009, 0xc00a, 0x009c, 0x009d, 0x002f, 0x0035];
const u16 = n => [(n >> 8) & 255, n & 255];
const u24 = n => [(n >> 16) & 255, (n >> 8) & 255, n & 255];

function clientHello(host) {
  const name = [...new TextEncoder().encode(host)];
  const ext = (type, data) => [...u16(type), ...u16(data.length), ...data];
  const sni = ext(0x0000, [...u16(name.length + 3), 0, ...u16(name.length), ...name]);
  const groups = ext(0x000a, [...u16(6), 0x00, 0x1d, 0x00, 0x17, 0x00, 0x18]);
  const points = ext(0x000b, [1, 0]);
  const sigs = [0x0403, 0x0503, 0x0603, 0x0804, 0x0805, 0x0806, 0x0401, 0x0501, 0x0601, 0x0201];
  const sigalg = ext(0x000d, [...u16(sigs.length * 2), ...sigs.flatMap(u16)]);
  const reneg = ext(0xff01, [0]);
  const exts = [...sni, ...groups, ...points, ...sigalg, ...reneg];
  const random = [...crypto.getRandomValues(new Uint8Array(32))];
  const body = [0x03, 0x03, ...random, 0, ...u16(SUITES.length * 2), ...SUITES.flatMap(u16), 1, 0, ...u16(exts.length), ...exts];
  const hs = [0x01, ...u24(body.length), ...body];
  return new Uint8Array([0x16, 0x03, 0x01, ...u16(hs.length), ...hs]);
}

// DER を1つ読む（tag, 中身の開始, 終わり）
function tlv(b, i) {
  const tag = b[i];
  let len = b[i + 1], p = i + 2;
  if (len & 0x80) { const n = len & 0x7f; len = 0; for (let k = 0; k < n; k++) len = len * 256 + b[p + k]; p += n; }
  return { tag, start: p, end: p + len };
}
function children(b, node) {
  const out = []; let i = node.start;
  while (i < node.end) { const c = tlv(b, i); out.push(c); i = c.end; }
  return out;
}
function derTime(b, node) {
  const s = new TextDecoder().decode(b.slice(node.start, node.end));
  let y, rest;
  if (node.tag === 0x17) { const yy = +s.slice(0, 2); y = yy >= 50 ? 1900 + yy : 2000 + yy; rest = s.slice(2); }
  else { y = +s.slice(0, 4); rest = s.slice(4); }
  return new Date(Date.UTC(y, +rest.slice(0, 2) - 1, +rest.slice(2, 4), +rest.slice(4, 6), +rest.slice(6, 8), +rest.slice(8, 10) || 0));
}
export function notAfterOf(der) {
  const cert = tlv(der, 0);
  const tbs = children(der, cert)[0];
  const f = children(der, tbs);
  const k = f[0].tag === 0xa0 ? 1 : 0; // version があれば1つずらす
  const validity = f[k + 3];
  const [nb, na] = children(der, validity);
  return { notBefore: derTime(der, nb), notAfter: derTime(der, na) };
}

async function viaHandshake(host, timeout) {
  const sock = connect({ hostname: host, port: 443 }, { secureTransport: "off" });
  const timer = new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), timeout));
  const work = (async () => {
    await sock.opened;
    const w = sock.writable.getWriter();
    await w.write(clientHello(host));
    const r = sock.readable.getReader();
    let buf = new Uint8Array(0);
    let hs = new Uint8Array(0);
    const push = (a, b) => { const c = new Uint8Array(a.length + b.length); c.set(a); c.set(b, a.length); return c; };
    while (true) {
      const { value, done } = await r.read();
      if (done) throw new Error("closed");
      buf = push(buf, value);
      // レコードを取り出す
      while (buf.length >= 5) {
        const type = buf[0], len = (buf[3] << 8) | buf[4];
        if (buf.length < 5 + len) break;
        const frag = buf.slice(5, 5 + len);
        buf = buf.slice(5 + len);
        if (type === 0x15) throw new Error("alert");
        if (type !== 0x16) continue;
        hs = push(hs, frag);
        // ハンドシェイクのメッセージを読む
        let i = 0;
        while (hs.length - i >= 4) {
          const mt = hs[i], ml = (hs[i + 1] << 16) | (hs[i + 2] << 8) | hs[i + 3];
          if (hs.length - i - 4 < ml) break;
          if (mt === 11) {
            const body = hs.slice(i + 4, i + 4 + ml);
            const first = (body[3] << 16) | (body[4] << 8) | body[5];
            return notAfterOf(body.slice(6, 6 + first));
          }
          i += 4 + ml;
        }
      }
    }
  })();
  try { return await Promise.race([work, timer]); }
  finally { try { await sock.close(); } catch (e) {} }
}

// 証明書の公開ログから、いま有効でこのホストを含む証明書のうち、期限がいちばん先のものを使う
// （Cloudflare などは複数の証明書を持つので、いちばん新しく出たものが配られていることが多い）
async function viaCrtSh(host, timeout) {
  const res = await fetch(`https://crt.sh/?q=${encodeURIComponent(host)}&output=json&exclude=expired`, { signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`crtsh ${res.status}`);
  const list = await res.json();
  const parent = host.split(".").slice(1).join(".");
  const now = Date.now();
  let best = null;
  for (const c of list) {
    const names = String(c.name_value || "").toLowerCase().split("\n");
    if (!names.includes(host) && !names.includes(`*.${parent}`)) continue;
    const nb = new Date(c.not_before + "Z"), na = new Date(c.not_after + "Z");
    if (!(nb.getTime() <= now && na.getTime() > now)) continue;
    if (!best || na > best.notAfter) best = { notBefore: nb, notAfter: na };
  }
  if (!best) throw new Error("crtsh none");
  return best;
}

/** { authorized, validTo, source } または { error } */
export async function certInfo(host) {
  try {
    const c = await viaHandshake(host, 6000);
    return { authorized: true, err: "", validTo: c.notAfter, source: "tls" };
  } catch (e) {
    try {
      const c = await viaCrtSh(host, 8000);
      return { authorized: true, err: "", validTo: c.notAfter, source: "ct" };
    } catch (e2) {
      return { error: String(e2 && e2.message || e2) };
    }
  }
}

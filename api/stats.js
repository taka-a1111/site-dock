'use strict';
// NVD の登録件数を返す（トップの「◯万件の脆弱性情報と照合」の表記に使う）。1日キャッシュ
const { total } = require('../lib/nvd.js');

module.exports = async (req, res) => {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  try {
    const t = await total();
    res.setHeader('cache-control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    res.statusCode = 200;
    res.end(JSON.stringify({ nvdTotal: t.total, asOf: t.asOf }));
  } catch (e) {
    res.setHeader('cache-control', 'no-store');
    res.statusCode = 502;
    res.end(JSON.stringify({ error: 'nvd' }));
  }
};

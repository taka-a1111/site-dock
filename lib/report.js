// スキゼロ 簡易診断 結果票（A4・全8ページ）の HTML を作る
// 入力は api/scan.js の runScan() の結果（detail つき）。
// 1ページ目：総合判定・部位図・先に直す3つ／2〜5ページ目：8項目の結果と直し方（1ページ2項目）
// 6ページ目：対応の順番と自分で直すか任せるかの目安／7ページ目：用語の説明／8ページ目：次の点検の目安とご案内

const LOGO = require('./logo-svg.js');

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ORDER = { A: 1, B: 2, C: 3, D: 4, E: 5 };
const GL = { A: '問題なし', B: '軽い注意', C: '要注意', D: '要対策', E: '至急対策', '-': '確認できず' };
const KEYS = ['ssl', 'php', 'core', 'plugins', 'users', 'files', 'headers', 'mail'];
const PRIORITY = ['ssl', 'plugins', 'php', 'core', 'files', 'users', 'mail', 'headers'];
const FULL = {
  ssl: '通信ののぞき見・警告画面', php: '修正が止まった土台のプログラム', core: '本体の更新漏れ', plugins: '危ない追加機能',
  users: 'ログイン名の丸見え', files: '見えてはいけないファイル', headers: '守りの設定の抜け', mail: 'なりすましメール',
};
const WHEN = { E: 'すぐに（今週中）', D: '2週間以内', C: '1か月以内', B: '次の更新のときに', A: '対応は不要', '-': '管理画面で確認' };
// 自分で直す目安［難しさ, 時間の目安, 誰がやるとよいか］
const EFFORT = {
  ssl: ['ふつう', '15〜30分', 'サーバーの管理画面を開ける方なら自分で'],
  php: ['むずかしい', '1〜2時間', '表示が崩れることがあるので、制作会社などに任せるのがおすすめ'],
  core: ['やさしい', '10〜30分', '管理画面のボタンで済むので自分で'],
  plugins: ['やさしい', '30分前後', '管理画面のボタンで済むので自分で'],
  users: ['ふつう', '30分前後', 'プラグインを入れられる方なら自分で'],
  files: ['やさしい', '10〜20分', 'ファイルを消せる方なら自分で'],
  headers: ['むずかしい', '30分〜1時間', '設定ファイルを触るので、制作会社などに任せるのがおすすめ'],
  mail: ['むずかしい', '30分〜1時間', 'DNSを触るので、制作会社などに任せるのがおすすめ'],
};
// 点検の方法（各項目の最後に載せる）
const HOW = {
  ssl: 'サイトにつないだときの証明書を読み、期限と、ブラウザが信頼できる発行元かどうかを確かめました。',
  php: 'サーバーの返事に書かれたPHPの版を読み、PHPの公式サイト（php.net）のサポート期限と照らし合わせました。',
  core: 'ページのソースやRSSに出るWordPressの版を読み、WordPress公式の最新版と照らし合わせました。',
  plugins: 'ページのソースに出るプラグインのフォルダ名と版を読み、WordPress公式の配布ページの最新版と照らし合わせました。',
  users: 'サイトの裏側の窓口（REST API）と投稿者ページから、ログイン名が読み取れるかを確かめました。',
  files: 'readme.html と、アップロード用のフォルダの中身の一覧が、外から開けるかを確かめました。',
  headers: 'トップページの返事に、ブラウザへの守り方の指示が6種類のうちいくつ入っているかを確かめました。',
  mail: 'ドメインの公開の設定（DNS）から、SPFとDMARCの記録を読みました。',
};
const isBad = g => ORDER[g] >= 3;
const gcls = g => (g === '-' ? 'gN' : 'g' + g);
const jstDate = iso => {
  const d = new Date(new Date(iso).getTime() + 9 * 3600000);
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
};
const jstTime = iso => {
  const d = new Date(new Date(iso).getTime() + 9 * 3600000);
  return `${jstDate(iso)} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

// ---------- 項目ごとの中身 ----------
// 返す形：{ facts: [[見出し, 内容]], meaning, steps: [], note, short: { why, how } }
function itemContent(key, row, scan) {
  const g = row.grade, d = scan.detail || {}, v = row.value;
  const wp = scan.wordpress;
  const c = { facts: [['見えた状態', v]], meaning: '', steps: [], note: '', short: { why: '', how: '' } };

  if (!wp && ['core', 'plugins', 'users', 'files'].includes(key)) {
    c.facts = [['見えた状態', 'WordPress以外のサイトのため対象外']];
    c.meaning = 'この項目はWordPressのサイトだけを点検します。お使いのサイトの仕組み（ほかのCMSや手作りのページなど）にも、本体の更新や追加機能の管理は必要です。';
    c.steps = ['サイトを作った会社に、使っている仕組みと、その更新の予定を確かめる', '管理画面のある仕組みなら、ログイン名とパスワードの管理を見直す'];
    return c;
  }

  switch (key) {
    case 'ssl': {
      const ct = d.cert || {};
      if (ct.validTo) c.facts.push(['証明書の期限', `${jstDate(ct.validTo)}（残り${ct.daysLeft}日）`]);
      if (g === 'A') {
        c.meaning = 'SSL証明書は有効で、通信は暗号化されています。お客さまのブラウザに警告は出ません。';
        c.steps = ['対応は不要です', '期限の2週間前に、自動更新が動いているかだけ確かめる（サーバーの管理画面の「SSL設定」）'];
      } else if (g === '-') {
        c.meaning = '証明書の状態を外から確認できませんでした。サイトが一時的に重かった可能性があります。';
        c.steps = ['https:// でサイトを開き、アドレスバーに鍵のマークが出るか確かめる', '警告が出る場合は、下の「直し方」と同じ手順で証明書を入れ直す'];
      } else {
        c.meaning = '証明書が切れていたり入っていなかったりすると、ブラウザに「保護されていない通信」などの警告が出て、お客さまがページを閉じてしまいます。お問い合わせフォームに入れた内容が、途中で読み取られるおそれもあります。';
        c.steps = [
          'サーバー会社の管理画面で「SSL設定」（「無料独自SSL」）を開き、このドメインの状態を見る',
          '無料SSL（Let\'s Encrypt）を有効にし、自動更新をオンにする。有料の証明書なら、発行元で更新してサーバーに入れ直す',
          '反映を待ち（数十分〜1時間）、https:// で開いて鍵のマークを確かめる',
          'WordPressの「設定 → 一般」のURLが https:// になっているか確かめる',
        ];
      }
      c.short = { why: g === 'A' ? '' : `証明書が「${v}」の状態です。お客さまのブラウザに警告が出ます。`, how: 'サーバーの管理画面で無料SSLを有効にし、自動更新をオンにする' };
      break;
    }
    case 'php': {
      const p = d.php || {};
      if (p.version) c.facts.push(['外から見えた版', `PHP ${p.version}（サーバーの返事に版が書かれている）`]);
      if (g === '-') {
        c.facts = [['見えた状態', '版は外から見えない設定']];
        c.meaning = '版が外から見えないのは、攻撃者に手がかりを与えないよい設定です。ただし、版そのものは確認できていません。2026年10月にもPHPの重大な弱点が公表されており、サポートが終わった版には修正版が出ていません。';
        c.steps = ['サーバー会社の管理画面の「PHPバージョン切替」などで、今の版を確かめる', '8.2 より前の版なら、下の手順で 8.3 以上に切り替える（先にバックアップを取る）'];
      } else if (ORDER[g] <= 2) {
        c.meaning = g === 'A' ? 'サポート中の版です。弱点が見つかっても修正版が出ます。' : 'セキュリティの修正だけが出る時期に入った版です。今すぐの危険はありませんが、次の切り替えの予定を立てておくと安心です。';
        c.steps = ['サーバー会社のお知らせで、サポート終了の時期を確かめておく', '版が外から見えないよう、サーバーの設定で expose_php を Off にする（見えていなければ不要）'];
      } else {
        c.meaning = 'PHPはWordPressを動かす土台のプログラムです。サポートが終わった版は、新しく見つかった弱点が直されません。2026年10月にもPHPの重大な弱点が公表され、サポートが終わった版には修正版が出ていません。外からサーバーを操られるおそれがあります。';
        c.steps = [
          'サーバー会社の管理画面とWordPressのプラグイン（BackWPupなど）で、バックアップを取る',
          'WordPress本体・テーマ・プラグインを先に最新にする（古いままだと新しいPHPで動かないことがある）',
          'サーバーの管理画面の「PHPバージョン切替」で 8.3 以上を選ぶ',
          'トップページ・お問い合わせフォーム・管理画面が開けるか確かめる。画面が真っ白になったら元の版に戻し、制作会社に相談する',
          '版が外から見えないよう、サーバーの設定で expose_php を Off にする',
        ];
      }
      c.short = { why: `${v}。新しく見つかった弱点が直されません。`, how: 'サーバー会社の管理画面で 8.3 以上を選ぶ。先にバックアップを取る' };
      break;
    }
    case 'core': {
      const cr = d.core || {};
      c.facts = [['今の版', cr.version ? `WordPress ${cr.version}` : '外から見えない設定'], ['最新の版', cr.latest ? `WordPress ${cr.latest}` : '確認できず']];
      if (g === 'A') {
        c.meaning = '最新の版です。直された弱点はすべて入っています。';
        c.steps = ['対応は不要です', '小さな更新（セキュリティの修正）の自動更新を、オンのままにしておく'];
      } else if (g === '-') {
        c.meaning = '版が外から見えない設定のため、更新の状態を確認できませんでした。版を隠しているのはよい設定です。';
        c.steps = ['管理画面の「ダッシュボード → 更新」で、最新版になっているか確かめる'];
      } else {
        c.meaning = '更新で直された弱点は、内容が公開されます。古い版のままのサイトは、その弱点を狙った攻撃の的になりやすくなります。';
        c.steps = [
          'バックアップを取る',
          'PHPが古い場合は、PHPの切り替えを先に済ませる',
          '管理画面の「ダッシュボード → 更新」から最新版に更新する',
          'トップページとお問い合わせフォームの表示を確かめる',
          '小さな更新の自動更新をオンにしておく',
        ];
      }
      c.short = { why: `${cr.version ? cr.version + 'のまま' : '古い版'}です。直された弱点の内容はすでに公表されています。`, how: '管理画面の「更新」から最新版へ。PHPの切り替えのあとに行う' };
      break;
    }
    case 'plugins': {
      const pl = d.plugins || { found: 0, list: [] };
      const st = { old: '更新が遅れている', closed: '配布停止（今後直されない）', ok: '最新', unknown: '版を確認できず' };
      c.facts.push(['外から見えた数', `${pl.found}件`]);
      c.table = pl.list.slice().sort((a, b) => ({ closed: 0, old: 1, unknown: 2, ok: 3 }[a.state] - { closed: 0, old: 1, unknown: 2, ok: 3 }[b.state]))
        .slice(0, 5).map(p => [p.slug, p.have || '—', p.latest || '—', st[p.state] || '', p.state === 'old' || p.state === 'closed']);
      if (pl.list.length > 5) c.tableMore = pl.list.length - 5;
      const bad = pl.list.filter(p => p.state === 'old' || p.state === 'closed');
      if (g === 'A') {
        c.meaning = '外から確認できたプラグインは、すべて最新でした。';
        c.steps = ['対応は不要です', '月に1回、管理画面の「プラグイン」で更新が出ていないか確かめる'];
      } else if (g === '-') {
        c.meaning = 'プラグインは、ページの中に名前が出ないものもあります。外から確認できなかったものにも、更新が必要なものがあるかもしれません。';
        c.steps = ['管理画面の「プラグイン」を開き、「更新が利用可能です」と出ているものを更新する', '使っていないプラグインは、停止して削除する'];
      } else {
        c.meaning = 'WordPressのサイトが乗っ取られる原因の多くは、プラグインの弱点です。更新が遅れたものは、公表された弱点がそのまま残っています。配布停止のものは、今後見つかる弱点も直されません。';
        c.steps = [
          'バックアップを取る',
          '管理画面の「プラグイン」で、上の表の「更新が遅れている」ものを1つずつ更新し、そのたびに表示を確かめる',
          bad.some(p => p.state === 'closed') ? '配布停止のものは、同じ働きの別のプラグインに置き換えてから削除する' : '更新できないものは、同じ働きの別のプラグインに置き換える',
          '使っていないプラグインは、停止して削除する',
          '自動更新を使う場合は、プラグイン一覧の「自動更新を有効化」をオンにする',
        ];
      }
      c.short = { why: bad.length ? `${bad.slice(0, 2).map(p => p.slug).join('、')}${bad.length > 2 ? ` ほか${bad.length - 2}件` : ''}が古いまま、または配布停止です。` : v, how: bad.some(p => p.state === 'closed') ? '古いものは更新し、配布停止のものは別のプラグインに置き換える' : '古いものを最新版に更新。使っていないものは停止して削除' };
      break;
    }
    case 'users': {
      const u = d.users || {};
      const via = [u.rest ? 'サイトの裏側の窓口（/wp-json/wp/v2/users）' : '', u.author ? '投稿者ページ（/?author=1 の転送先）' : ''].filter(Boolean);
      if (via.length) c.facts.push(['見えた場所', via.join('、')]);
      if (g === 'A') {
        c.meaning = '管理画面のログイン名は、外から読み取れませんでした。';
        c.steps = ['対応は不要です', 'パスワードは12文字以上にし、ほかのサービスと使い回さない'];
      } else {
        c.meaning = 'ログイン名がわかると、攻撃者はパスワードだけを当てればよくなります。機械で何万回も試す「総当たり」の攻撃が通りやすくなります。';
        c.steps = [
          'セキュリティのプラグイン（SiteGuard WP Plugin、XO Security など）を入れる',
          '「ユーザー名の漏えい防止」「投稿者アーカイブの無効化」「REST APIのユーザー一覧の停止」をオンにする',
          '「ユーザー → プロフィール」で、ブログ上の表示名をログイン名と別の名前にする',
          'ログインの回数制限と、2段階の認証（スマホのアプリで確認）をオンにする',
        ];
      }
      c.short = { why: '管理画面のログイン名が外から読み取れます。', how: 'セキュリティのプラグインで、ログイン名を外に出さない設定をオンにする' };
      break;
    }
    case 'files': {
      const f = d.files || {};
      const found = [f.readme ? 'readme.html（WordPressの説明ファイル）' : '', f.listing ? 'アップロードしたファイルの一覧（/wp-content/uploads/）' : ''].filter(Boolean);
      if (found.length) c.facts.push(['見えたもの', found.join('、')]);
      if (g === 'A') {
        c.meaning = '外から見えてはいけないファイルは、見つかりませんでした。';
        c.steps = ['対応は不要です', 'WordPressの更新のあとに readme.html が戻っていないか、ときどき確かめる'];
      } else {
        c.meaning = f.listing
          ? 'フォルダの中身が一覧で見える状態です。お客さまから届いた書類の画像など、公開するつもりのないファイルまで見つけられてしまいます。'
          : 'readme.html はWordPressの説明ファイルで、残っていると、WordPressを使っていることや版の手がかりを与えます。危険は小さいものの、消しておくのが基本です。';
        c.steps = [
          f.readme ? 'サーバーのファイルマネージャーやFTPで、サイトの一番上の readme.html を削除する（WordPressの更新のたびに戻るので、更新のあとにも消す）' : '',
          f.listing ? 'サイトの一番上にある .htaccess に「Options -Indexes」を1行足し、フォルダの中身の一覧を出さないようにする' : '',
          f.listing ? '一覧で見えていたフォルダに、公開するつもりのないファイルがないか確かめ、あれば削除する' : '',
        ].filter(Boolean);
      }
      c.short = { why: f.listing ? 'フォルダの中身の一覧が外から見えます。' : 'readme.html が残っています。', how: f.listing ? '.htaccess に「Options -Indexes」を足す' : 'readme.html を削除する' };
      break;
    }
    case 'headers': {
      const hs = d.headers || [];
      c.checks = hs;
      const miss = hs.filter(h => !h.ok).map(h => h.name);
      if (g === 'A') {
        c.meaning = 'ブラウザへの守り方の指示（セキュリティのヘッダー）が、ほぼそろっています。';
        c.steps = ['対応は不要です', 'サーバーを引っ越すときは、同じ設定を引き継ぐ'];
      } else {
        c.meaning = 'サーバーがブラウザに「この守り方をしてください」と伝える設定です。足りないと、偽のページにサイトを埋め込まれてボタンを押させられる攻撃や、通信の盗み見を防ぎにくくなります。';
        const lines = [];
        if (miss.includes('HTTPからHTTPSへの転送')) lines.push('RewriteEngine On', 'RewriteCond %{HTTPS} off', 'RewriteRule ^(.*)$ https://%{HTTP_HOST}/$1 [R=301,L]');
        if (miss.includes('HSTS')) lines.push('Header always set Strict-Transport-Security "max-age=31536000"');
        if (miss.includes('MIMEタイプの固定')) lines.push('Header always set X-Content-Type-Options "nosniff"');
        if (miss.includes('埋め込みの制限')) lines.push('Header always set X-Frame-Options "SAMEORIGIN"');
        if (miss.includes('リファラーの制限')) lines.push('Header always set Referrer-Policy "strict-origin-when-cross-origin"');
        c.code = lines;
        c.steps = [
          'サイトの一番上にある .htaccess を、変更の前に手元へ保存しておく',
          lines.length ? '.htaccess の先頭に、下の行を足す（足りないものだけを並べています）' : '',
          miss.includes('CSP') ? 'CSP（読み込んでよい場所の指定）は表示が崩れることがあるため、制作会社と相談して入れる' : '',
          '保存したら、トップページ・お問い合わせフォーム・管理画面が開けるか確かめる。開けなければ保存しておいた .htaccess に戻す',
        ].filter(Boolean);
      }
      c.short = { why: `ブラウザへの守り方の指示が${v}だけです。`, how: '.htaccess に足りない設定を足す（2ページ目以降に書き方あり）' };
      break;
    }
    case 'mail': {
      const m = d.mail || {};
      if (!m.error) {
        c.facts.push(['SPFの記録', m.spfRecord || '設定なし']);
        c.facts.push(['DMARCの記録', m.dmarcRecord || '設定なし']);
      }
      if (g === 'A') {
        c.meaning = 'SPFとDMARCがそろい、なりすましメールを受け取った側で止められる設定です。';
        c.steps = ['対応は不要です', 'メールの送り先のサービス（メール配信など）を増やしたときは、SPFに足す'];
      } else if (g === '-') {
        c.meaning = 'ドメインの設定を読み取れませんでした。時間をおいて、もう一度診断してください。';
        c.steps = ['もう一度、無料の簡易診断を行う'];
      } else {
        c.meaning = g === 'B'
          ? 'SPFとDMARCはありますが、DMARCが「見張るだけ（p=none）」のため、なりすましメールは相手に届いてしまいます。'
          : '会社のドメインをかたった偽のメール（請求書や振込先の変更を装うもの）を、受け取った側で見分けにくい状態です。2024年からGmailなどは、この設定のないメールを迷惑メールに振り分けることがあり、本物のメールが届かない原因にもなります。';
        c.steps = g === 'B' ? [
          'DMARCのレポート（rua に書いた宛先に届くもの）で、本物のメールが合格しているか確かめる',
          '問題がなければ、DMARCの p=none を p=quarantine（迷惑メールへ）に変える',
          'しばらく様子を見て、p=reject（受け取り拒否）にする',
        ] : [
          'このドメインでメールを送っているサービス（サーバーのメール、Google Workspace、Microsoft 365、メール配信など）を書き出す',
          m.spf ? 'SPFはあるので、送っているサービスが全部入っているかだけ確かめる' : 'ドメインの設定（DNS）に SPF を1行足す。例：v=spf1 include:_spf.google.com ~all（使うサービスで中身が変わる）',
          m.dmarc ? 'DMARCはあるので、p= の値を確かめる' : 'DNSに DMARC を1行足す。名前は _dmarc、例：v=DMARC1; p=none; rua=mailto:レポートを受け取るアドレス',
          '送っているサービスの管理画面で、DKIM（電子署名）をオンにする',
          '2〜4週間レポートを見て問題がなければ、p=quarantine に強める',
        ];
        c.note = 'このドメインでメールを使っていない場合は、SPF「v=spf1 -all」とDMARC「v=DMARC1; p=reject」を入れておくと、なりすましを防げます。';
      }
      c.short = { why: `${v}。会社名をかたったメールを見分けにくい状態です。`, how: 'ドメインの設定（DNS）にSPF・DMARCを1行ずつ足す' };
      break;
    }
  }
  return c;
}

// ---------- 部位図（1ページ目） ----------
const PIN = { ssl: [82, 21], php: [88, 211], core: [100, 75], plugins: [223, 64], users: [223, 127], files: [50, 146], headers: [206, 210], mail: [266, 226] };
const PINC = g => (ORDER[g] >= 4 ? '#C8323C' : g === 'C' ? '#B07414' : g === '-' ? '#8A9A9E' : '#2F7D5B');
function anatomy(rows) {
  const pins = KEYS.map((k, i) => {
    const r = rows.find(x => x.key === k) || { grade: '-' };
    const [x, y] = PIN[k];
    return `<circle cx="${x}" cy="${y}" r="11" fill="${PINC(r.grade)}" stroke="#fff" stroke-width="2"/><text x="${x}" y="${y + 4}" text-anchor="middle">${i + 1}</text>`;
  }).join('');
  return `<svg viewBox="0 0 300 250" font-family="Zen Kaku Gothic New, sans-serif">
<rect x="20" y="10" width="260" height="158" rx="6" fill="#fff" stroke="#12343B" stroke-width="3"/>
<rect x="20" y="10" width="260" height="22" rx="6" fill="#12343B"/><circle cx="34" cy="21" r="3" fill="#fff"/><circle cx="44" cy="21" r="3" fill="#fff"/><circle cx="54" cy="21" r="3" fill="#fff"/>
<rect x="70" y="15" width="150" height="12" rx="6" fill="#fff"/>
<rect x="34" y="44" width="130" height="62" fill="#CFE5DC"/><rect x="180" y="44" width="86" height="40" fill="none" stroke="#A7C2B9"/>
<rect x="34" y="116" width="110" height="5" fill="#D6E3DD"/><rect x="34" y="126" width="80" height="5" fill="#D6E3DD"/>
<rect x="180" y="100" width="86" height="54" fill="none" stroke="#A7C2B9"/>
<rect x="40" y="186" width="96" height="50" rx="4" fill="#12343B"/><rect x="48" y="196" width="80" height="12" rx="2" fill="#24494F"/><rect x="48" y="214" width="80" height="12" rx="2" fill="#24494F"/>
<path d="M88 168v18" stroke="#12343B" stroke-dasharray="3 3" stroke-width="2"/>
<path d="M206 188l22 8v14c0 12-10 19-22 22-12-3-22-10-22-22v-14z" fill="#2F7D5B"/>
<rect x="244" y="186" width="44" height="30" rx="3" fill="#fff" stroke="#12343B" stroke-width="2"/><path d="M244 188l22 15 22-15" fill="none" stroke="#12343B" stroke-width="2"/>
<g font-size="11" font-weight="900" fill="#fff">${pins}</g></svg>`;
}

// ---------- 見た目 ----------
const CSS = `
@page{size:A4;margin:0}
:root{--ink:#12343B;--mid:#41595E;--light:#6B8186;--go:#2F7D5B;--tint:#E6F1ED;--red:#C8323C;--paper:#F1F4F2;--rule:#C9D9D2;--soft:#E3ECE8;--warn:#B07414;--warnbg:#FBF3E4;--redbg:#FBECEC}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#fff}
body{font-family:"BIZ UDPGothic","游ゴシック","Yu Gothic","メイリオ","Noto Sans JP","Noto Sans CJK JP",sans-serif;color:var(--ink);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:794px;height:1123px;padding:44px 50px 36px;position:relative;overflow:hidden;page-break-after:always;break-after:page}
.page:last-child{page-break-after:auto;break-after:auto}
.disp,h1,h2,h3{font-family:"Zen Kaku Gothic New","游ゴシック","Yu Gothic",sans-serif}
.logo svg{height:30px;width:auto;display:block}
.g{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:50%;font-weight:700;font-size:13.5px;color:#fff;font-family:"Zen Kaku Gothic New",sans-serif;flex:none}
.gA,.gB{background:var(--go)}.gC{background:var(--warn)}.gD,.gE{background:var(--red)}.gN{background:#8A9A9E}
.tag{display:inline-block;font-size:10.5px;color:var(--go);background:var(--tint);padding:0 6px;font-weight:700;margin-left:6px;vertical-align:2px;font-family:"BIZ UDPGothic",sans-serif}
.foot{position:absolute;left:50px;right:50px;bottom:28px;display:flex;justify-content:space-between;font-size:10.5px;color:var(--light);border-top:1px solid var(--soft);padding-top:8px}
.id{position:absolute;top:44px;right:50px;font-size:10.5px;color:var(--light);text-align:right;line-height:1.6}
/* 1ページ目 */
.top{margin-top:20px;display:flex;justify-content:space-between;align-items:flex-end;gap:16px}
.top h1{font-size:27px;font-weight:900}
.top p{font-size:12px;color:var(--mid);margin-top:4px}
.dom{font-size:14px;font-weight:700;color:var(--go);word-break:break-all;text-align:right}
.band{margin-top:16px;background:var(--ink);color:#fff;border-radius:6px;padding:16px 20px;display:grid;grid-template-columns:150px 1fr;gap:20px;align-items:center}
.band .big{text-align:center}
.band .big small{display:block;font-size:11px;color:#A6BDB8;font-weight:700}
.band .big b{display:block;font-family:"Zen Kaku Gothic New",sans-serif;font-size:52px;font-weight:900;line-height:1.1}
.scale{display:grid;grid-template-columns:repeat(5,1fr);gap:4px}
.scale span{text-align:center;font-family:"Zen Kaku Gothic New",sans-serif;font-weight:900;font-size:15px;padding:6px 0;border-radius:3px;background:rgba(255,255,255,.1);color:#A6BDB8}
.scale span.on{color:#fff;outline:2px solid #fff}
.scale-lb{display:grid;grid-template-columns:repeat(5,1fr);font-size:10px;color:#A6BDB8;text-align:center;margin-top:4px}
.band p{font-size:12.5px;line-height:1.7;margin-top:10px}
.mid{display:grid;grid-template-columns:330px 1fr;gap:22px;margin-top:18px}
.mid h2{font-weight:900;font-size:15.5px;margin-bottom:8px}
.fig{background:var(--tint);border-radius:6px;padding:12px}
.legend{display:flex;gap:12px;font-size:10.5px;color:var(--mid);margin-top:8px;justify-content:center}
.legend i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px;vertical-align:-1px}
.pri{list-style:none}
.pri li{border:1px solid var(--rule);border-left:5px solid var(--red);border-radius:4px;padding:9px 12px;margin-bottom:8px}
.pri li.c{border-left-color:var(--warn)}.pri li.ok{border-left-color:var(--go)}
.pri .h{display:flex;justify-content:space-between;align-items:center;gap:8px}
.pri b{font-size:13.5px}
.pri p{font-size:11.5px;color:var(--mid);line-height:1.6;margin-top:3px}
.pri .how{color:var(--ink);background:var(--paper);padding:4px 8px;margin-top:5px}
table.all{width:100%;border-collapse:collapse;font-size:11.5px;margin-top:4px}
table.all td{border-bottom:1px solid var(--soft);padding:6px 4px}
table.all td:last-child{text-align:right;width:36px}
table.all td.v{color:var(--mid);font-size:11px}
.note{margin-top:12px;font-size:11px;color:var(--light);line-height:1.7}
/* 2ページ目以降 */
.ph{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid var(--ink);padding-bottom:10px}
.ph .logo svg{height:22px}
.ph span{font-size:11px;color:var(--mid)}
.pt{font-size:19px;font-weight:900;margin-top:16px}
.pt small{font-size:11.5px;font-weight:400;color:var(--mid);margin-left:10px;font-family:"BIZ UDPGothic",sans-serif}
.page.items{display:flex;flex-direction:column;padding-bottom:70px}
.item{margin-top:12px;border:1px solid var(--rule);border-radius:6px;padding:12px 16px;flex:1 1 auto;min-height:0;overflow:hidden}
.ih{display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--soft);padding-bottom:9px}
.ih .no{font-family:"Zen Kaku Gothic New",sans-serif;font-weight:900;font-size:13px;width:24px;height:24px;border-radius:4px;background:var(--ink);color:#fff;display:grid;place-items:center;flex:none}
.ih h2{font-size:16px;font-weight:900;flex:1}
.ih .gl{font-size:12px;font-weight:700}
.ih .gl.r{color:var(--red)}.ih .gl.w{color:var(--warn)}.ih .gl.o{color:var(--go)}.ih .gl.n{color:#6B7B7F}
.facts{display:grid;grid-template-columns:110px 1fr;font-size:11.5px;margin-top:8px}
.facts dt{color:var(--mid);padding:4px 0;border-bottom:1px dotted var(--rule)}
.facts dd{padding:4px 0;border-bottom:1px dotted var(--rule);word-break:break-all}
.lbl{font-size:11px;font-weight:700;color:var(--go);margin-top:8px;letter-spacing:.04em}
.mean{font-size:11.8px;line-height:1.68;margin-top:2px}
ol.steps{margin-top:4px;padding-left:0;list-style:none;counter-reset:s}
ol.steps li{counter-increment:s;position:relative;padding-left:24px;font-size:11.6px;line-height:1.58;margin-top:2px}
ol.steps li::before{content:counter(s);position:absolute;left:0;top:2px;width:17px;height:17px;border-radius:50%;background:var(--go);color:#fff;font-size:10px;font-weight:700;display:grid;place-items:center}
.code{background:#F4F6F5;border:1px solid var(--soft);font-family:Consolas,"Courier New",monospace;font-size:10px;line-height:1.55;padding:6px 9px;margin-top:5px;white-space:pre-wrap;word-break:break-all}
.ptab{width:100%;border-collapse:collapse;font-size:10.5px;margin-top:6px}
.ptab th{background:var(--paper);text-align:left;padding:3px 6px;font-weight:700;color:var(--mid)}
.ptab td{padding:3px 6px;border-bottom:1px solid var(--soft);word-break:break-all}
.ptab tr.bad td{color:var(--red);font-weight:700}
.chk{display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px 10px;font-size:11px;margin-top:6px}
.chk span{padding:3px 8px;border-radius:3px;background:var(--tint)}
.chk span.x{background:var(--redbg);color:var(--red);font-weight:700}
.eff{display:flex;flex-wrap:wrap;gap:2px 16px;font-size:10.8px;color:var(--mid);margin-top:9px;background:var(--paper);padding:5px 10px;border-radius:3px}
.eff b{color:var(--ink)}
.eff span{white-space:nowrap}
.how2{font-size:10.5px;color:var(--light);margin-top:8px;line-height:1.55}
.small{font-size:10.8px;color:var(--mid);line-height:1.6;margin-top:6px}
/* 6〜8ページ目 */
table.ord{width:100%;border-collapse:collapse;font-size:11.5px;margin-top:10px}
table.ord th{background:var(--ink);color:#fff;font-weight:700;text-align:left;padding:6px 8px;font-size:11px;white-space:nowrap}
table.ord td{border-bottom:1px solid var(--rule);padding:5px 8px;vertical-align:middle;line-height:1.45;font-size:11px}
table.ord td.ef{white-space:nowrap}
table.ord td.c{text-align:center}
table.ord td.when{font-weight:700;white-space:nowrap}
table.ord tr.hot td.when{color:var(--red)}
table.log td{height:21px;padding:2px 8px}
.box{border:1px solid var(--rule);border-radius:6px;padding:11px 16px;margin-top:12px}
.box h3{font-size:14px;font-weight:900;margin-bottom:6px}
.box ul{list-style:none}
.box li{font-size:11.8px;line-height:1.7;padding-left:14px;position:relative;margin-top:2px}
.box li::before{content:"";position:absolute;left:2px;top:9px;width:6px;height:6px;border-radius:50%;background:var(--go)}
.req{background:#F7F9F8;border:1px dashed var(--rule);padding:8px 14px;font-size:11px;line-height:1.65;margin-top:8px;white-space:pre-wrap}
dl.gloss{display:grid;grid-template-columns:1fr 1fr;gap:6px 22px;margin-top:10px}
dl.gloss div{border-bottom:1px solid var(--soft);padding-bottom:5px}
dl.gloss dt{font-size:12.5px;font-weight:700;font-family:"Zen Kaku Gothic New",sans-serif}
dl.gloss dt small{font-weight:400;color:var(--light);font-size:10.5px;margin-left:6px;font-family:"BIZ UDPGothic",sans-serif}
dl.gloss dd{font-size:11px;line-height:1.55;color:var(--mid);margin-top:2px}
.sched{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:10px}
.sched div{border:1px solid var(--rule);border-radius:6px;padding:8px 12px;font-size:11px;line-height:1.55}
.sched div.on{border:2px solid var(--go);background:var(--tint)}
.sched b{display:block;font-size:13px;margin-bottom:3px}
.plans{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:10px}
.plans div{border:1px solid var(--rule);border-radius:6px;padding:8px 12px;font-size:10.5px;line-height:1.55;color:var(--mid)}
.plans b{display:block;font-size:13px;color:var(--ink)}
.plans em{display:block;font-style:normal;font-family:"Zen Kaku Gothic New",sans-serif;font-weight:900;font-size:16px;color:var(--ink);margin:2px 0 4px}
`;

function head(scan, title, sub) {
  return `<div class="ph"><div class="logo">${LOGO}</div><span>簡易診断 結果票　${esc(scan.domain)}</span></div>
<h2 class="pt">${title}${sub ? `<small>${sub}</small>` : ''}</h2>`;
}
const foot = n => `<div class="foot"><span>スキゼロ　簡易診断 結果票</span><span>${n} / 8</span></div>`;

function itemBlock(scan, key) {
  const row = scan.rows.find(r => r.key === key);
  const i = KEYS.indexOf(key) + 1;
  const c = itemContent(key, row, scan);
  const g = row.grade;
  const glc = ORDER[g] >= 4 ? 'r' : g === 'C' ? 'w' : g === '-' ? 'n' : 'o';
  const glText = g === '-' && /対象外|WordPress以外/.test(row.value) ? '対象外' : GL[g];
  const ef = EFFORT[key];
  const showEff = isBad(g);
  return `<section class="item">
<div class="ih"><span class="no">${i}</span><h2>${esc(FULL[key])}<span class="tag">${esc(row.tag)}</span></h2><span class="gl ${glc}">${esc(glText)}</span><span class="g ${gcls(g)}">${g}</span></div>
<dl class="facts">${c.facts.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('')}</dl>
${c.table && c.table.length ? `<table class="ptab"><tr><th>プラグイン（フォルダ名）</th><th>今の版</th><th>最新の版</th><th>状態</th></tr>${c.table.map(t => `<tr${t[4] ? ' class="bad"' : ''}><td>${esc(t[0])}</td><td>${esc(t[1])}</td><td>${esc(t[2])}</td><td>${esc(t[3])}</td></tr>`).join('')}</table>${c.tableMore ? `<p class="small">ほか${c.tableMore}件</p>` : ''}` : ''}
${c.checks && c.checks.length ? `<div class="chk">${c.checks.map(h => `<span class="${h.ok ? '' : 'x'}">${h.ok ? '○' : '×'} ${esc(h.name)}</span>`).join('')}</div>` : ''}
<p class="lbl">この判定の意味</p><p class="mean">${esc(c.meaning)}</p>
<p class="lbl">${isBad(g) ? '直し方の手順' : 'これからやること'}</p><ol class="steps">${c.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
${c.code && c.code.length ? `<div class="code">${esc(c.code.join('\n'))}</div>` : ''}
${c.note ? `<p class="small">${esc(c.note)}</p>` : ''}
<p class="how2">点検の方法：${esc(HOW[key])}</p>
${showEff ? `<div class="eff"><span>難しさ <b>${ef[0]}</b></span><span>時間の目安 <b>${ef[1]}</b></span><span>${esc(ef[2])}</span></div>` : ''}
</section>`;
}

// ---------- 本体 ----------
function buildReportHtml(scan, opts = {}) {
  const rows = scan.rows;
  const byKey = k => rows.find(r => r.key === k) || { grade: '-', value: '', tag: '' };
  const og = scan.overall.grade;
  const bad = rows.filter(r => ORDER[r.grade] >= 4).length;
  const warn = rows.filter(r => r.grade === 'C').length;
  const reportId = opts.reportId || 'SD-' + jstDate(scan.checkedAt).replace(/[年月]/g, '-').replace('日', '');
  const ogColor = ORDER[og] >= 4 ? '#FF8A8F' : og === 'C' ? '#F2C46D' : '#8FD3B0';

  let bandText;
  if (ORDER[og] >= 4) bandText = `8項目のうち${bad}項目が D・E${warn ? `、${warn}項目が C` : ''}でした。外から攻撃の入口として狙われやすい状態です。下の「先に直す3つ」から順に直してください。直し方の手順は2ページ目から載せています。`;
  else if (og === 'C') bandText = `大きな弱点はありませんが、${warn}項目に気をつけたい点があります。1か月以内の対応をおすすめします。直し方の手順は2ページ目から載せています。`;
  else bandText = '大きな弱点は見つかりませんでした。今の状態を保つために、3か月ごとの点検をおすすめします。';
  if (!scan.wordpress) bandText += '　WordPress以外のサイトのため、3〜6の項目は対象外です。';

  const fixes = PRIORITY.map(byKey).filter(r => isBad(r.grade)).sort((a, b) => ORDER[b.grade] - ORDER[a.grade]);
  const top3 = fixes.slice(0, 3), rest = fixes.slice(3);
  const circled = ['①', '②', '③'];
  let pri = top3.map((r, i) => {
    const c = itemContent(r.key, r, scan);
    return `<li class="${r.grade === 'C' ? 'c' : ''}"><div class="h"><b>${circled[i]} ${esc(r.label)}<span class="tag">${esc(r.tag)}</span></b><span class="g ${gcls(r.grade)}">${r.grade}</span></div><p>${esc(c.short.why)}</p><p class="how">${esc(c.short.how)}</p></li>`;
  }).join('');
  if (rest.length) pri += `<li class="c"><div class="h"><b>そのほか ${rest.length}件</b></div><p>${esc(rest.map(r => r.label).join('、'))}。手順は2ページ目から項目ごとに載せています。</p></li>`;
  if (!top3.length) pri = `<li class="ok"><div class="h"><b>先に直すものはありません</b><span class="g gA">✓</span></div><p>8項目に、すぐに直す必要のある弱点はありませんでした。判定B（軽い注意）の項目は、次の更新のときに見直してください。</p><p class="how">3か月ごとに、もう一度無料の簡易診断で確かめる</p></li>`;
  const unknown = rows.filter(r => r.grade === '-' && !/対象外|WordPress以外/.test(r.value));
  if (unknown.length && top3.length < 3) pri += `<li class="c"><div class="h"><b>外から確かめられなかった ${unknown.length}件</b></div><p>${esc(unknown.map(r => r.label).join('、'))}。管理画面で確かめる方法を、2ページ目から載せています。</p></li>`;

  const p1 = `<div class="page">
<div class="logo">${LOGO}</div>
<div class="id">受付番号　${esc(reportId)}<br>診断日時　${esc(jstTime(scan.checkedAt))}</div>
<div class="top"><div><h1 class="disp">ホームページ健康診断　結果票</h1><p>公開されている情報だけを、ふつうの閲覧と同じ方法で確認しました</p></div><span class="dom">${esc(scan.domain)}</span></div>
<div class="band"><div class="big"><small>総合判定</small><b style="color:${ogColor}">${og}</b><small style="color:${ogColor};font-size:13px">${GL[og]}</small></div><div><div class="scale">${['A', 'B', 'C', 'D', 'E'].map(x => `<span class="${x === og ? 'on' : ''}" style="${x === og ? `background:${ORDER[x] >= 4 ? '#C8323C' : x === 'C' ? '#B07414' : '#2F7D5B'}` : ''}">${x}</span>`).join('')}</div><div class="scale-lb">${['A', 'B', 'C', 'D', 'E'].map(x => `<span>${GL[x]}</span>`).join('')}</div><p>${esc(bandText)}</p></div></div>
<div class="mid">
<div><h2>どこに弱点があるか</h2>
<div class="fig">${anatomy(rows)}
<div class="legend"><span><i style="background:#C8323C"></i>要対策</span><span><i style="background:#B07414"></i>要注意</span><span><i style="background:#2F7D5B"></i>良好</span><span><i style="background:#8A9A9E"></i>確認できず</span></div></div>
<h2 style="margin-top:14px">全項目の判定</h2>
<table class="all">${KEYS.map((k, i) => { const r = byKey(k); return `<tr><td>${i + 1} ${esc(r.label)}</td><td class="v">${esc(r.value)}</td><td><span class="g ${gcls(r.grade)}">${r.grade}</span></td></tr>`; }).join('')}</table></div>
<div><h2>先に直す3つ</h2><ol class="pri">${pri}</ol></div>
</div>
<p class="note">この結果票は、そのまま制作会社さまへ転送していただけます。判定は公開されている情報だけで行ったもので、管理画面やサーバーの中は確認していません。</p>
${foot(1)}</div>`;

  const pairs = [['ssl', 'php'], ['core', 'plugins'], ['users', 'files'], ['headers', 'mail']];
  const itemPages = pairs.map((pr, i) => `<div class="page items">${head(scan, '項目ごとの結果と直し方', `${i * 2 + 1}〜${i * 2 + 2}番目の項目（全8項目）`)}${pr.map(k => itemBlock(scan, k)).join('')}${foot(i + 2)}</div>`).join('');

  // 6ページ目：対応の順番
  const sorted = KEYS.map(byKey).slice().sort((a, b) => {
    const ga = a.grade === '-' ? 2.5 : ORDER[a.grade], gb = b.grade === '-' ? 2.5 : ORDER[b.grade];
    return gb - ga || PRIORITY.indexOf(a.key) - PRIORITY.indexOf(b.key);
  });
  const ordRows = sorted.map((r, i) => {
    const na = r.grade === '-' && /対象外|WordPress以外/.test(r.value);
    const when = na ? '対象外' : WHEN[r.grade];
    const ef = EFFORT[r.key];
    const need = isBad(r.grade);
    return `<tr class="${ORDER[r.grade] >= 4 ? 'hot' : ''}"><td class="c">${i + 1}</td><td>${esc(r.label)}<span class="tag">${esc(r.tag)}</span></td><td class="c"><span class="g ${gcls(r.grade)}">${r.grade}</span></td><td class="when">${esc(when)}</td><td class="ef">${need ? `${ef[0]}<br>${ef[1]}` : '—'}</td><td>${need ? esc(ef[2]) : '—'}</td></tr>`;
  }).join('');
  const needList = sorted.filter(r => isBad(r.grade));
  const reqText = needList.length
    ? `いつもお世話になっております。
ホームページ（${scan.domain}）の簡易診断を受けたところ、次の項目で対応が必要と出ました。
${needList.map(r => `・${r.label}（${r.tag}）：${r.value}`).join('\n')}
添付の結果票の2ページ目から、項目ごとの直し方の手順が載っています。
対応の可否と、費用・日程の目安をお知らせいただけますでしょうか。`
    : `いつもお世話になっております。
ホームページ（${scan.domain}）の簡易診断を受けたところ、大きな弱点は見つかりませんでした。
今の状態を保つため、次回の更新作業のときに、結果票のB判定の項目もあわせて見ていただけますと幸いです。`;
  const p6 = `<div class="page">${head(scan, '対応の順番と、自分で直すか任せるかの目安')}
<table class="ord"><tr><th style="width:40px">順番</th><th>項目</th><th style="width:44px">判定</th><th>いつまでに</th><th>難しさ・時間</th><th>誰がやるとよいか</th></tr>${ordRows}</table>
<div class="box"><h3>自分で直すか、任せるかの分け方</h3><ul>
<li>管理画面のボタンで済むもの（WordPress本体・プラグインの更新、readme.html の削除）は、ご自身で直せます。作業の前にバックアップを取ってください。</li>
<li>サーバーの設定やドメインの設定（DNS）を触るもの（PHPの切り替え、守りの設定、SPF・DMARC）は、表示が崩れたりメールが届かなくなったりすることがあるため、サイトを作った会社やサーバーに詳しい方に任せるのがおすすめです。</li>
<li>どちらでも、作業のあとにもう一度無料の簡易診断を行うと、直ったかどうかを確かめられます。</li>
</ul></div>
<div class="box"><h3>制作会社さまへの依頼文の例</h3><p class="small" style="margin-top:0">そのまま写して、結果票と一緒にお送りください。</p><div class="req">${esc(reqText)}</div></div>
<p class="small">スキゼロでも、対策作業（14,800円から）を承ります。結果票をお送りいただければ、お見積もりします。</p>
${foot(6)}</div>`;

  // 7ページ目：用語
  const terms = [
    ['弱点（脆弱性）', 'ぜいじゃくせい', 'プログラムの作りの誤りで、攻撃者に悪用されるすき。見つかると、作った側が直した版（修正版）を出します。'],
    ['SSL証明書', '', 'サイトとお客さまの間の通信を暗号化するための電子の証明書。期限があり、切れるとブラウザに警告が出ます。'],
    ['PHP', 'ピーエイチピー', 'WordPressを動かしているプログラムの言葉。版ごとにサポートの期限があり、終わった版は弱点が直されません。'],
    ['WordPress本体', '', 'サイトの土台になる仕組み。年に数回の大きな更新と、弱点を直す小さな更新があります。'],
    ['プラグイン', '', 'WordPressに機能を足す部品。お問い合わせフォームや予約などに使います。作った人が別々なので、更新の管理が大切です。'],
    ['ログイン名', 'ユーザー名', '管理画面に入るときの名前。パスワードと組で使うため、外に見せないのが基本です。'],
    ['総当たり攻撃', '', 'ログイン名とパスワードの組み合わせを、機械で何万回も試して当てる攻撃。'],
    ['readme.html', '', 'WordPressに付いてくる説明のファイル。サイトの運営には要りません。'],
    ['.htaccess', 'エイチティーアクセス', 'サーバーの動き方を決める設定のファイル。書き間違えるとサイトが開かなくなるため、変更前に保存しておきます。'],
    ['セキュリティのヘッダー', '', 'サーバーがブラウザに伝える「この守り方をしてください」という指示。HSTS・CSPなどがあります。'],
    ['HSTS', '', '「このサイトは必ず暗号化して開いてください」とブラウザに覚えさせる指示。'],
    ['CSP', '', '「このサイトで読み込んでよいのはここだけ」とブラウザに伝える指示。偽の部品を差し込む攻撃を防ぎます。'],
    ['DNS', 'ディーエヌエス', 'ドメイン名と、サーバーやメールの行き先を結びつける名簿。ドメインを買ったサービスの管理画面で設定します。'],
    ['SPF', '', '「このドメインのメールを送ってよいサーバーはここ」という名簿。DNSに1行で書きます。'],
    ['DMARC', 'ディーマーク', 'SPFなどの確認に通らなかったメールを、受け取った側でどう扱うか（見張るだけ・迷惑メールへ・拒否）の指示。'],
    ['DKIM', 'ディーキム', '送ったメールに付ける電子の署名。途中で書き換えられていないことを証明します。'],
    ['バックアップ', '', 'サイトのファイルとデータの控え。更新で不具合が出たときに、元に戻すために使います。'],
    ['2段階の認証', '', 'パスワードに加えて、スマホのアプリなどで本人かどうかを確かめる仕組み。'],
  ];
  const p7 = `<div class="page">${head(scan, '用語の説明と、判定の見方', '結果票に出てくる言葉の意味')}
<dl class="gloss">${terms.map(([t, r, d]) => `<div><dt>${esc(t)}${r ? `<small>${esc(r)}</small>` : ''}</dt><dd>${esc(d)}</dd></div>`).join('')}</dl>
<div class="box"><h3>判定（A〜E）の見方</h3><table class="ord" style="margin-top:4px">
<tr><th style="width:60px">判定</th><th>意味</th><th style="width:150px">対応の目安</th></tr>
${[['A', '問題は見つかりませんでした'], ['B', '小さな注意点があります。急ぎではありません'], ['C', 'ほかの弱点と重なると狙われやすくなります'], ['D', '攻撃の入口になりやすい弱点があります'], ['E', 'すでに公表された重大な弱点が残っています'], ['-', '外から確認できませんでした（版を隠している場合など）']].map(([g, t]) => `<tr><td class="c"><span class="g ${gcls(g)}">${g}</span></td><td>${GL[g]}：${t}</td><td>${WHEN[g]}</td></tr>`).join('')}
</table></div>
${foot(7)}</div>`;

  // 8ページ目：次の点検とご案内
  const tier = ORDER[og] >= 4 ? 0 : og === 'C' ? 1 : 2;
  const logRows = sorted.filter(r => isBad(r.grade) || (r.grade === '-' && !/対象外|WordPress以外/.test(r.value))).slice(0, 5);
  const p8 = `<div class="page">${head(scan, '次に点検する時期の目安と、ご案内')}
<p class="mean" style="margin-top:10px">今回の総合判定は「${og}（${GL[og]}）」でした。次の点検の目安は、判定ごとに次のとおりです。</p>
<div class="sched">
<div class="${tier === 0 ? 'on' : ''}"><b>D・E の場合</b>直したらすぐに、もう一度無料の簡易診断で確かめてください。そのあとは1か月ごとの点検がおすすめです。</div>
<div class="${tier === 1 ? 'on' : ''}"><b>C の場合</b>1か月以内に直し、直したあとにもう一度診断してください。そのあとは3か月ごとの点検がおすすめです。</div>
<div class="${tier === 2 ? 'on' : ''}"><b>A・B の場合</b>3か月ごとの点検で十分です。WordPressの大きな更新のあとにも、一度確かめると安心です。</div>
</div>
<p class="small">もう一度の診断は、https://sukizero.com/ で同じURLを入れるだけです。登録は要りません。</p>
<div class="box"><h3>この簡易診断でわからないこと</h3><ul>
<li>管理画面の中の設定や、ユーザーの権限</li>
<li>サーバーの中にあるファイルの改ざんや、隠れた不正なプログラム</li>
<li>ページに名前が出ないプラグインや、外から版が読めないプラグイン</li>
<li>バックアップが取れているかどうか</li>
</ul><p class="small">これらは詳細診断で、管理画面とサーバーの中まで確かめます。</p></div>
<h3 style="font-size:14px;font-weight:900;margin-top:14px">続けて守るためのプラン</h3>
<div class="plans">
<div><b>詳細診断</b><em>29,800円</em>管理画面とサーバー設定の確認、プラグインとアカウントの棚卸し。報告書とオンラインでのご説明、対策後の再診断1回つき。</div>
<div><b>定期診断ライト</b><em>月4,980円</em>週1回の自動点検と、月1回の結果票。使っているプラグインに新しい弱点が出たら、メールでお知らせします。</div>
<div><b>定期診断スタンダード</b><em>月19,800円</em>毎日の自動点検と改ざんの検知。月1回のPHP・プラグイン更新の代行と、緊急時の初動対応までお任せいただけます。</div>
</div>
<div class="box"><h3>ご相談・お問い合わせ</h3><ul>
<li>お問い合わせフォーム：https://sukizero.com/contact.html</li>
<li>営業日（平日9:00〜18:00）のうちにご返信します。この結果票の受付番号（${esc(reportId)}）をお書き添えください。</li>
<li>無理なおすすめはしません。結果票の見方だけのご質問も歓迎です。</li>
</ul></div>
${logRows.length ? `<h3 style="font-size:14px;font-weight:900;margin-top:16px">対応の記録<small style="font-weight:400;font-size:11px;color:var(--mid);margin-left:8px">印刷して、直した日と担当を書き込めます</small></h3>
<table class="ord log"><tr><th>項目</th><th style="width:44px">判定</th><th style="width:110px">直した日</th><th style="width:110px">担当</th><th>メモ</th></tr>${logRows.map(r => `<tr><td>${esc(r.label)}</td><td class="c"><span class="g ${gcls(r.grade)}">${r.grade}</span></td><td></td><td></td><td></td></tr>`).join('')}</table>` : ''}
<p class="note">この結果票は、${esc(jstTime(scan.checkedAt))} の時点で、公開されている情報だけをもとに自動で作成したものです。サイトの安全を保証するものではありません。判定に使った情報は、サイトの設定の変更により変わることがあります。</p>
${foot(8)}</div>`;

  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>スキゼロ 簡易診断 結果票 ${esc(scan.domain)}</title>
<link href="https://fonts.googleapis.com/css2?family=BIZ+UDPGothic:wght@400;700&family=Zen+Kaku+Gothic+New:wght@700;900&display=block" rel="stylesheet">
<style>${CSS}</style></head><body>${p1}${itemPages}${p6}${p7}${p8}</body></html>`;
}

module.exports = { buildReportHtml, itemContent };

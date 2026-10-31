# スキゼロ

WordPressサイトの無料簡易診断と、詳細診断・定期診断の受付サイト。

- 静的ページ：ルート直下の *.html、blog/、assets/、img/
- 無料簡易診断：api/scan.js（公開情報だけを GET で読む非侵入型の7項目点検）
- 受付：api/request.js（結果票の請求・お問い合わせを Supabase の sitedock_requests に保存し、Helm の受信箱へ通知）

## 環境変数（Vercel）
- SITEDOCK_SUPABASE_URL
- SITEDOCK_SUPABASE_KEY（publishable key。sitedock_requests は追加のみ許可、読み出し不可）

## 表示確認
各ページのフッターと console に BUILD_TAG を出している。

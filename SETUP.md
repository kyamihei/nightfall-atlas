# セットアップ手順

これまで作成したファイルを実際に動かすまでの流れです。上から順に進めれば一通り繋がります。

**方針まとめ**
- 配信者管理: 手動リストではなく、対象ゲームカテゴリ×日本語配信からTwitch Helix APIで自動発見（`tracked_broadcasters`テーブルに蓄積）
- ホスティング: Vercel（Vite製フロント＋Cron Jobsでの定期同期がしやすいため）
- ブランディング: 「ClipVote」／ダークなスコアボード風デザインのまま

## 1. Supabaseプロジェクトを作る

1. https://supabase.com でプロジェクトを新規作成
2. SQL Editorで `supabase-schema.sql` を実行（テーブル・RLS・トリガーが作成される）
3. Authentication → Providers で **Anonymous Sign-ins** を有効化
4. Project Settings → API から以下を控える
   - `Project URL` → `VITE_SUPABASE_URL`
   - `anon public key` → `VITE_SUPABASE_ANON_KEY`
   - `service_role key` → Edge Function・バッチ用（フロントには絶対に置かない）
5. SQL Editorで集計用RPCも作成しておく（`use-clip-ranking.ts`のコメント内に定義あり、`get_reaction_counts`）

## 2. Twitch Developer Consoleでアプリを登録

1. https://dev.twitch.tv/console/apps でアプリを新規作成
2. `Client ID` と `Client Secret`（`New Secret`ボタン）を控える
3. 収集したいゲームカテゴリのIDを控える（`/helix/games?name=Rust`等で取得可能。例: Rust, VALORANT, Street Fighter 6, Escape from Tarkovなど、直近の人気タグに合わせて選定）

## 3. Edge Functionをデプロイ

```bash
supabase functions deploy post-comment
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=xxxx
```

`post-comment-edge-function.ts` を `supabase/functions/post-comment/index.ts` に配置してからデプロイしてください。

## 4. クリップ同期バッチを定期実行

`sync-twitch-clips.ts` に以下の環境変数を渡して実行します。配信者IDの手動登録は不要です。

```bash
export TWITCH_CLIENT_ID=xxxx
export TWITCH_CLIENT_SECRET=xxxx
export SUPABASE_URL=xxxx
export SUPABASE_SERVICE_ROLE_KEY=xxxx
export TARGET_GAME_IDS=263490,516575,516585   # 対象ゲームカテゴリID（Rust, VALORANT等）

deno run --allow-net --allow-env sync-twitch-clips.ts
```

Vercel Cron Jobs（`vercel.json`に`crons`設定を追加）から1日1回程度実行する想定です。実行のたびに新しい配信者が自動的に`tracked_broadcasters`に追加されていきます。

## 5. フロントエンドをVercelにデプロイ

1. GitHubリポジトリにプッシュし、Vercelでインポート
2. Environment Variablesに以下を設定
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=xxxx
   ```
3. `clip-ranking-prototype.jsx` の `window.storage` 呼び出し部分を、`use-clip-ranking.ts` の
   `useClips` / `useReactions` / `useFavorites` / `useComments` に差し替える
4. デプロイ後、独自ドメインを接続（任意）

## まだ決めていないこと

- 対象ゲームカテゴリの初期リスト（まずは今回のランキングに出ていたRust, VALORANT, Street Fighter 6, Escape from Tarkov, FF16あたりから始めるのが自然）
- 独自ドメインを取得するかどうか、取得する場合のドメイン名


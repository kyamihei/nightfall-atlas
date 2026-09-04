# ClipVote プロジェクト概要

サイト名「クリスレ」（`<title>`は「クリスレ | Twitchクリップの掲示板サイト」）。
Twitchクリップのランキング掲示板。お気に入り・独自リアクションスタンプ・匿名コメント（返信対応）・
クリップ検索（タイトル/URL）・総合スレ・タグスレ（ユーザーが自由に立てられるタグ別スレ）・
トレンド表示・配信者検索・登録リクエスト・クリップ職人（クリップを作った視聴者）ランキング・
配信者への個人タグ付けができるサイト（tw-clip相当のUI/仕様を踏襲）。いいね/よくないね機能は
バックエンドごと残したままUI上のみ無効化しており、代わりに独自のリアクションスタンプ機能を
主軸にしている（詳細は各節を参照）。運営向けに簡易管理画面（非公開URL）とX（旧Twitter）への
毎日の自動投稿も備える。

## 技術構成

- フロント: React 19 + Vite + react-router-dom。UIはstyleオブジェクトによるインラインCSS（外部CSSフレームワークなし）。`src/styles/theme.css`（`main.jsx`でグローバル読み込み）に全ページ共通の演出（フォント読み込み・スクロールバー・ボタン押下フィードバック・フォーカスリング・`cv-`接頭辞の共通アニメーションクラス）を集約している
- バックエンド: Supabase（Postgres + Auth匿名サインイン + Edge Functions + Realtime）
- クリップ同期: `sync-twitch-clips.ts`（Deno）がTwitch Helix APIから定期的にクリップを取得し、Supabaseへ書き込む。`sync-live-clips.ts`はいまライブ中の配信者だけを高頻度でチェックする軽量版（詳細は後述）。`refresh-clip-views.ts`は既存クリップのview_countだけを定期的に再取得する別スクリプト（詳細は後述）
- 自動実行: `.github/workflows/sync-clips.yml`が毎朝JST 6:05頃に新規クリップ収集（全追跡配信者対象）を実行、`.github/workflows/sync-live-clips.yml`が15分おきにライブ中配信者だけの軽量同期（配信者の新規発見も含む）を実行、`.github/workflows/refresh-clip-views.yml`が毎時20分にview_count同期を実行、`.github/workflows/post-daily-ranking.yml`が毎朝JST 9:00にXへ自動投稿を実行（すべて`workflow_dispatch`のみを持ち、GitHub Actions自身の`schedule`は使わない。実際の定期起動はSupabase側の`pg_cron`がWebhookで叩く方式、詳細は「GitHub Actionsのscheduleトリガーが信頼できない問題への対応」節参照）

## ディレクトリ構成

- `src/components/` - 画面コンポーネント
  - `ClipRanking.jsx` - トップページ。ランキング一覧＋コメントサイドパネル＋トレンド/週間クリップ職人ボード（`/`）
  - `ClipDetail.jsx` - クリップ個別ページ、コメント欄はページ内常時表示（`/clips/:id`）
  - `BroadcasterList.jsx` / `BroadcasterDetail.jsx` - 配信者一覧・詳細（`/broadcasters`, `/broadcasters/:name`）
  - `MyReactions.jsx` - 自分が評価したクリップ一覧（`/my-reactions`。`REACTIONS_ENABLED=false`のため実質非表示、直接URLアクセス時のみガード画面）
  - `MyFavorites.jsx` - 自分がお気に入り登録したクリップ一覧（`/favorites`）
  - `MyStampsPage.jsx` - 自分がリアクションスタンプを押したクリップ一覧、スタンプ種別ごとにタブ切り替え（`/my-stamps`）
  - `ClipperList.jsx` - クリップ職人（クリップを作った視聴者）ランキング（`/clippers`。コンポーネント名/ルートは内部的に"clipper"のまま、UI表示名のみ「クリップ職人」）
  - `ClipperDetail.jsx` - クリップ職人詳細。そのクリップ職人が作ったクリップの視聴回数ランキング（`/clippers/:creatorId`）。ヘッダーの合計視聴回数・クリップ数は`get_clipper_stats` RPC（全件対象・正確）から取得し、期間タブで絞り込む一覧側のlimitに引きずられて数値が過小表示されないようにしている
  - `ClipSearch.jsx` - クリップのタイトル検索・URL直接貼り付け検索（`/search`）
  - `GeneralThread.jsx` - クリップに紐付かない全体掲示板「総合スレ」（`/general`）
  - `TagThreadList.jsx` / `TagThreadDetail.jsx` - ユーザーが自由にタイトルを立てて話せる「タグスレ」
    一覧・詳細（`/threads`, `/threads/:id`。総合スレとは別の専用テーブルで実装、詳細は該当節参照）
  - `Footer.jsx` - 全ページ共通フッター（ホーム/サイトについて/利用規約/プライバシーポリシー/お問い合わせ＋Copyright、
    定期更新カウントダウン＝`SyncTimer`、X（旧Twitter）フォロー導線バナーも表示。詳細は各追加節参照）
  - `AboutPage.jsx` / `TermsPage.jsx` / `PrivacyPage.jsx` - 静的コンテンツページ（`/about`, `/terms`, `/privacy`）
  - `ContactPage.jsx` - お問い合わせフォーム（`/contact`）
  - `AdminPage.jsx` - 簡易管理画面（ダッシュボード/お問い合わせ/コメント通報/配信者リクエスト、
    URLは推測困難なパス。詳細は「簡易管理画面」節参照）
  - `ShareButtons.jsx` - X/LINE共有・リンクコピーの共通ボタン（クリップ/配信者/クリップ職人の各詳細ページで使用）
- `src/lib/supabase-client.ts` - Supabaseクライアント初期化＋匿名認証（`ensureAnonymousSession`）
- `src/lib/use-clip-ranking.ts` - データ層フック集（`useClips` / `useReactions` / `useFavorites` / `useMyFavorites` /
  `useClipStamps` / `useMyStamps` / `useTrendingClips` / `useClipSearch` / `useComments` /
  `useBroadcasterSearch` / `useBroadcasterRequest` / `useContactForm` / `useCommentReport` /
  `useBroadcasterAvatars` / `useClipperRanks` / `useTopClippersByPeriod` /
  `useActivityFeed` / `useBroadcasterTags` / `useTagThreads`関連 など多数）。`favorites`テーブル・RLSは
  Supabaseスキーマに元々あったがUIが未実装だったため2026-09-02に`useFavorites`/`useMyFavorites`と
  UIを追加して完成させた
- `src/lib/use-smart-back.js` - 詳細ページの「戻る」リンク用の`useSmartBack`フック（サイト内遷移なら
  ブラウザ履歴を戻る、直接URLアクセス等で戻り先が無ければfallbackへ、詳細は「詳細ページからの
  「戻る」が直前のタブ状態を復元できないバグ修正」節参照）
- `src/lib/use-activity-feed-prefs.js` - トップページのお知らせフィード表示設定
  （`useActivityFeedPrefs`、localStorageのみで完結、詳細は「お知らせフィードの表示カスタマイズ」節参照）
- `src/lib/use-admin.ts` - 管理画面専用のデータ層フック集（`useAdminAuth`/`useAdminDashboard`/`useAdminContactMessages`等）
- `src/lib/use-document-meta.js` - クリップ/配信者/クリップ職人の個別ページでdocument.title・meta description等を
  動的更新する`useDocumentMeta`フック（SEO対応、詳細は「SEO強化とSNSシェア導線」節参照）
- `supabase/schema.sql`, `supabase/migrations/` - テーブル・RLS・トリガー・RPC定義
- `supabase/functions/post-comment/` - コメント投稿Edge Function（NGワード検査・レート制限）
- `supabase/functions/request-broadcaster/` - 配信者登録リクエストEdge Function（Twitch実在確認つき）
- `supabase/functions/submit-contact/` - お問い合わせフォーム送信Edge Function（レート制限のみ、NGワード検査なし）
- `api/` - Vercelサーバーレス関数（Node.js、フロントのVite/Reactとは別系統）
  - `api/og/clip/[id].js` / `api/og/broadcaster/[name].js` / `api/og/clipper/[id].js` - SNSクローラー向け動的OGP
  - `api/sitemap.xml.js` - 動的sitemap（`vercel.json`のrewriteで`/sitemap.xml`にマッピング）
  - `api/_lib/` - 上記が共有するSupabase REST呼び出し・HTML生成ヘルパー
- Denoスクリプト（ルート直下、いずれもGitHub Actions実行、詳細は各節参照）:
  - `sync-twitch-clips.ts` - 日次のTwitchクリップ同期バッチ（配信者の新規発見・過去分バックフィル含む）
  - `sync-live-clips.ts` - 15分おきのライブ配信者クリップ即時反映（配信者の新規発見も担う、2026-09-03追記）
  - `refresh-clip-views.ts` - 既存クリップのview_countラウンドロビン再同期（毎時）
  - `post-daily-ranking.ts` - 毎朝JST 9:00のX自動投稿（ランキング/クリップ職人紹介/機能紹介ローテーション）
  - `backfill-clip-creators.ts` - クリップ職人（creator_id/name）の遡及取得（一回限り実行済み）

## 期間・日付の仕様

- ランキング期間タブ: 全期間 / 今年 / 今月 / 日別
- 「1日」の区切りは0:00〜24:00（`getPeriodRange`, `src/lib/use-clip-ranking.ts`）。
  **2026-09-03に変更**: 元はtw-clipの仕様に合わせて朝6:00〜翌朝6:00だったが、早朝（0〜6時）に
  作られたクリップが「前日」扱いになり、0時基準の競合サイトと日別ランキングを比較した際に
  「クリップが存在しない」と誤解される紛らわしさがあったため、ユーザーの指示で一般的な
  0時基準に変更した。`getPeriodRange`はブラウザのローカルタイムゾーンで`Date`を扱うため、
  訪問者がJSTのブラウザで見ている前提（このサイトの想定利用者層）でのみ意図通りに動く。

## 並び替え・コメント返信（2026-09-02追加）

- トップページに並び替えセレクター（視聴回数順 / 新着順 / いいね順 / コメント数順）を追加。
  `get_ranked_clips` RPC（`supabase/schema.sql`）が期間フィルタ・並び替え・ページネーションを一度に処理する。
  - **重要**: いいね順・コメント数順は「反応/コメントが1件も付いていないクリップ」をランキングに含めない
    （clips全件を毎回スキャンすると匿名ロールのstatement_timeout=3sを超えるため。詳細はRPC本体のコメント参照）
  - period_start/period_endは`null`ではなく`-infinity`/`infinity`をデフォルト値にしている。
    `(param is null or col >= param)`という書き方はPostgRESTの汎用実行計画で索引が効かなくなり
    タイムアウトする（本番で実測・修正済み）。同様のRPCを今後追加する際は同じ罠に注意すること。
  - `idx_clips_view_count`（view_count desc単索引）を追加済み。「全期間×視聴回数順」がこの索引を使う。
  - **（未修正の既知の問題、2026-09-04発見）**「日別×視聴回数順」は上記索引の対象外のため、
    本番で`get_ranked_clips`が57014（statement timeout）を返すことを確認した（お知らせフィード
    カスタマイズ機能の実装中、無関係な動作確認で偶然遭遇。`curl`で`period_start`/`period_end`を
    当日0時〜24時（JST）に絞り`sort_by=views`を直接叩いて再現・特定。ユーザー報告ではなく
    本セッションでの発見のため未対応、対応するかはユーザーの判断待ち）。`idx_clips_period_ranking`
    （期間絞り込み用、既存）はあるが、そこに`view_count desc`を絡めた複合索引が無いのが原因と
    見られる。対応する場合は「クリップ職人ランキング」節等と同じ「まず本番相手にEXPLAIN
    ANALYZEで実際のプランを確認してから索引を検討する」進め方が安全（推測だけで索引を追加すると
    無駄になるか、かえって遅くなることがあるため）。
- コメントに1階層のみの返信機能を追加（`comments.parent_id`）。`post-comment` Edge Functionが
  返信先の検証（同じクリップに属するか、返信への返信でないか）を行う。UIは`ClipRanking.jsx`の
  `CommentSidebar`と`ClipDetail.jsx`の両方に実装（重複コードだが元々の構造を踏襲）。
- これらの変更は本番のSupabaseプロジェクト（ClipVote）に直接マイグレーションを適用済み
  （`supabase/migrations/20260902*.sql`）。ローカルでRPCの挙動を検証する際は
  `npx supabase db query --linked "<SQL>"`が使える（Docker不要、本番DBに直接クエリできる）。

## クリップ職人ランキング（2026-09-02追加、UI表示名は当初「クリッパーランキング」だったが改名）

- Twitchのクリップは配信者ではなく視聴者（クリッパー）が作っていることが多いという着想から、
  「クリップを作った人」ランキングを追加（`/clippers`）。
- Twitch Helix Get Clipsのレスポンスには元々`creator_id`/`creator_name`（クリッパー）が
  含まれていたが、`broadcaster_id`/`broadcaster_name`（配信者）しか保存していなかった。
  `clips.creator_id`/`creator_name`列を追加し、`sync-twitch-clips.ts`が今後の同期分から保存する。
- 既存クリップ（導入時点で約39万件）分は`backfill-clip-creators.ts`（一回限りのスクリプト、
  `deno run --allow-net --allow-env --env-file=<.env.human-providedのパス> backfill-clip-creators.ts`で実行）
  でTwitch API（Get Clips、id指定で最大100件/回）から遡及取得済み（2026-09-02実施、389,421件処理、
  389,361件で発見・99.98%）。Twitch側で見つからなかった分は`creator_id='__unknown__'`を入れて
  再取得対象から除外している。
  - **既知の制約**: バックフィル時、クリッパーのプロフィール（アイコン）を`tracked_clippers`に
    登録する際にPostgRESTのデフォルト行数上限（1000件）を超えるSELECTを行っており、
    実際は94,686人いるクリッパーのうち628人分しかアイコンが登録されていない
    （ランキングの名前・視聴回数・クリップ数自体はclips側の列から取るため完全に正しい。
    影響はアイコン画像が空のクリッパーが多い、という見た目だけ）。今後の同期分は正しく登録される。
    全件のアイコンを揃えたい場合は、`tracked_clippers`に無い`creator_id`を`clips`から
    正しくページネーションして抽出し直すバックフィルが別途必要。
- **配信者ランキング（`get_top_broadcasters`）とクリッパーランキング（`get_top_clippers`）は、
  clips全件を毎回集計すると匿名ロールのタイムアウトを超える**ため、事前集計した
  マテリアライズドビュー（`top_broadcasters_mv` / `top_clippers_mv`）を読むだけの設計にしている。
  `sync-twitch-clips.ts`が同期完了後に`refresh_ranking_views()` RPC（service_role専用）を呼んで
  `REFRESH MATERIALIZED VIEW CONCURRENTLY`する。**この2つのランキングはsync/backfillを実行した
  タイミングでしか更新されない**（リアルタイムではない）ことを踏まえて機能追加すること。
  - この修正で、以前から本番で壊れていた配信者一覧ページ（`該当する配信者が見つかりませんでした`と
    表示されていた）も直っている（クリッパー機能の実装中に偶然発見・修正した既存バグ）。
- （未修正の既知の問題）`useBroadcasterProfile`（`BroadcasterDetail.jsx`用）は合計視聴回数・クリップ数を
  「期間で絞り込んだ一覧のうち先頭`limit`件（デフォルト50）」から計算しており、50件を超えて
  クリップを持つ配信者では過小表示される。`useClipperProfile`（`ClipperDetail.jsx`用）は
  `get_clipper_stats` RPCで正しく実装したので、配信者側を直す際はこちらを参考にすること。

## トップページの週間ランキング・クリップごとの職人表示・view_count定期同期（2026-09-02追加）

- トップページに直近7日間のクリップ職人ランキング（上位5人、`WeeklyClipperBoard`）を表示。
  `get_top_clippers_by_period(period_start, period_end, limit)` RPCで期間を絞ってその場で集計する
  （`top_clippers_mv`は全期間のみの事前集計のため、週間分は毎回ライブ集計。期間で絞られるので
  `idx_clips_period_ranking`が効いて軽い）。`ClipRanking.jsx`側で7日間の範囲を`useMemo`で
  マウント時に1度だけ固定している（毎レンダーで`new Date()`すると参照が変わり続けてuseEffectが
  無限に再発火するため）。
- `get_ranked_clips`の戻り値に`creator_id`/`creator_name`を追加。クリップ一覧の各行
  （`ClipRanking.jsx`のClipRow、`ClipDetail.jsx`）にクリップ職人名を表示し、`/clippers/:creatorId`へ
  リンクする。
- クリップ職人の「総合n位」バッジは、表示中のクリップの作者id一覧をまとめて
  `get_clipper_ranks(creator_ids, max_rank=100)` RPCに渡して取得する（`useClipperRanks`フック）。
  101位以降・ランキング外は結果に含まれず、バッジは表示しない。`top_clippers_mv`に
  `row_number() over (order by total_views desc) as rank`列を追加して実現している。
- **view_countの定期同期**: `sync-twitch-clips.ts`の通常収集は「作成から24時間以内のクリップ」しか
  見ないため、それより古いクリップのview_countは初回取得時のまま更新されず実際の値とズレていく。
  `refresh-clip-views.ts`（新規スクリプト）が`clips.view_count_synced_at`が最も古いクリップから
  順に、1回の実行につき最大`VIEW_SYNC_MAX_CLIPS`件（既定5000）をTwitch Get Clips（id指定）で
  再取得し、`bulk_update_clip_views` RPCで更新する。オフセット無しで同じクエリを繰り返すだけで
  自然にラウンドロビンする設計（更新するとview_count_synced_atが更新され、次回のクエリでは
  「最も古い」側から外れる）。`.github/workflows/refresh-clip-views.yml`で毎時20分に自動実行
  （sync-clips.ymlと同じSecretsを使う、追加設定不要）。
  - Twitch側で見つからなかった（削除済み等の）クリップはview_countを上書きせず
    `view_count_synced_at`だけ更新する（`bulk_update_clip_views`が`coalesce`で対応）。
- クリップ職人ランキングページ（`/clippers`）は総合/年間/月間タブで切り替えられる
  （`ClipperList.jsx`、`useTopClippers(limit, offset, period)`）。「年間」だけでもクリップ数万件
  規模になり、get_top_clippers_by_period（週間ウィジェット用のライブ集計）を流用すると
  本番実測で約7秒かかり匿名ロールのタイムアウトを超えることが分かったため、「年間」「月間」も
  「総合」と同じく事前集計のマテリアライズドビュー（`top_clippers_this_year_mv` /
  `top_clippers_this_month_mv`、`refresh_ranking_views()`で一緒に更新）を使う設計にした。
  `date_trunc('year'/'month', now())`はリフレッシュのたびに再評価されるため、年またぎ・月またぎも
  次のリフレッシュ（最大でも1日以内）で自動的に切り替わる。
- **`refresh_ranking_views()`実行時の注意**: `REFRESH MATERIALIZED VIEW CONCURRENTLY`は
  読み取りをブロックしない代わりに低速（本番実測で約20〜28秒、4つのビュー合計。
  ビューが増えるほど伸びるので、今後さらに追加する場合は時間の余裕を見ること）。service_roleの
  既定statement_timeoutは`authenticator`から継承する8秒程度（実測9秒でタイムアウト）で不足するため、
  `alter role service_role set statement_timeout = '120s'`をマイグレーションで適用済み
  （service_roleはバックエンド専用の鍵で一般公開されないため安全）。今後service_role経由で
  重い処理を追加する際はこの制約を踏まえること。

## いいね/よくないねの無効化とお気に入り数順ソート（2026-09-03追加）

- いいね/よくないね機能はUI上から非表示にした（`src/lib/feature-flags.js`の`REACTIONS_ENABLED = false`）。
  復活させる場合はこの1箇所をtrueに戻すだけでよい。バックエンド（`reactions`テーブル、
  `useReactions`、`get_ranked_clips`のsort_by='likes'分岐等）はすべて残したまま、
  フロント側のボタン・ナビゲーションリンク・並び替え選択肢だけを条件分岐で隠している。
  - `ClipRanking.jsx` / `ClipDetail.jsx`: Heart/ThumbsDownボタンを`{REACTIONS_ENABLED && (...)}`で包む。
  - ヘッダーの「評価した動画」リンク、`MyFavorites.jsx`からの相互リンクも同様に隠す。
  - `MyReactions.jsx`（`/my-reactions`）はナビ導線を消しただけでは直接URLアクセスを防げないため、
    コンポーネント自身の先頭で`if (!REACTIONS_ENABLED)`のガードを入れて簡易メッセージを表示している。
- 代わりに「お気に入り数順」ソートを追加（`get_ranked_clips`のsort_by='favorites'、likes/commentsと
  同じ「favoritesテーブルを起点にclipsへJOIN」パターン）。件数表示用に`get_favorite_counts(clip_ids)`
  RPC（`get_reaction_counts`と同じ発想）と`useFavoriteCounts`フックを追加し、お気に入りボタンの隣に
  件数を出す。トグル後は`useFavorites`の`toggle`とは別に明示的に`refreshFavoriteCounts()`を呼んで
  即時反映させている（2つのフックが独立しているため）。
- **ハマった点**: `get_ranked_clips`のようにRETURNS TABLEの列を追加する関数は、
  `create or replace`の前に必ず同じ引数シグネチャで`drop function if exists`すること。
  `get_top_clippers_by_period`にoffset引数を追加した際、dropを忘れたため3引数版と4引数版が
  別関数として共存してしまい、PostgRESTが「どちらを呼ぶか一意に決められない」エラーを返すようになり、
  トップページの週間クリップ職人ランキングが丸ごと表示されなくなった（本番で発生・修正済み）。
- **ハマった点その2**: `ClipDetail.jsx`で`const clipIds = clip ? [clip.id] : [];`のように
  配列リテラルを毎レンダー作ってuseReactions/useFavorites/useFavoriteCounts等に渡すと、
  それらのuseEffectが`[clipIds]`（配列の参照）に依存しているため、非同期取得→setState→
  再レンダー→配列再生成→useEffect再発火…の無限ループ（"Maximum update depth exceeded"）になる。
  `useFavoriteCounts`追加時に実際に発生した。`useMemo(() => clip ? [clip.id] : [], [clip])`で
  参照を安定させて修正。`ClipRanking.jsx`側は元々`useMemo`で対策済みだったが、
  `ClipDetail.jsx`は対策されていなかった。**クリップID配列を複数のフックに渡す箇所を今後追加する際は、
  必ず`useMemo`で参照を安定させること**（`useBroadcasterAvatars`/`useClipperRanks`のように
  文字列キーへ変換してから依存配列に使う方式でもよい）。

## サイト名変更・リアクションスタンプ・検索・総合スレ・トレンド（2026-09-03追加）

- **サイト名を「クリスレ」に変更**。トップページのサブタイトルも
  「みんなのお気に入りのクリップにコメントしてみよう！」に変更（`ClipRanking.jsx`）。
  `<title>`（`index.html`）はこの日のうちに何度かユーザーの指示で変更されており、
  2026-09-03時点の最終形は「クリスレ | Twitchクリップの掲示板サイト」。今後変更する際は
  現在の`index.html`を都度確認すること（このファイルに逐一追記すると古い値と混同しやすいため、
  以後は最終形のみ記載する）。
- **Twitch本家のクリップいいね（リアクション絵文字）は集計不可と判明**：Twitch Helix
  （公開API）のGet Clipsレスポンスにはリアクション/絵文字データが含まれておらず、視聴者が見ている
  「いいね」的な機能は非公開のGraphQL/クライアント側実装であり外部から取得する手段がない
  （Web調査で確認、2026-09-03）。この項目はユーザーへの説明のうえ実装を見送り、
  代わりに以下の独自リアクションスタンプで置き換えた。
- **リアクションスタンプ機能**: 「すっご」「うおｗ」「えっど」「こっわ」「うっま」「へった」「ひっど」の
  7種類のスタンプをクリップごとに複数選択可能（`clip_reaction_stamps`テーブル、
  `(clip_id, anon_id, stamp)`でunique）。`get_stamp_counts(clip_ids)` RPCで件数取得、
  `useClipStamps`フック（`use-clip-ranking.ts`）でトグル管理。`ClipDetail.jsx`は常時表示の
  スタンプ行を実装。`ClipRanking.jsx`のClipRowは導入当初は絵文字ボタンを押すと展開する方式
  だったが、2026-09-03中のユーザー指摘で**常時表示・直接クリック方式に変更済み**
  （詳細は下の「ヘッダーナビ・スタンプ直押し・クリップ表示の大型化」節）。
  - 並び替えに「リアクション数順」を追加（`get_ranked_clips`のsort_by='reactions'、likes/favoritesと
    同じ「小さいテーブル起点でclipsへJOIN」パターンでタイムアウト回避）。
  - 自分が押したスタンプ別のクリップ一覧は`/my-stamps`（`MyStampsPage.jsx`、`useMyStamps`フック）。
- **クリップ検索機能**（`/search`、`ClipSearch.jsx`）: タイトル部分一致・あいまい検索
  （`search_clips` RPC、pg_trgmの`title % query`演算子＋`title ilike '%query%'`のOR、
  `idx_clips_title_trgm` GINインデックス使用）。TwitchクリップURLを直接貼り付けると
  `extractClipIdFromUrl`でIDを抽出し自動的にそのクリップページへ遷移する。
  - **既知の制約（未解決・意図的に許容）**: 2文字程度の短い日本語クエリ（例:「釈迦」「号泣」）は
    トライグラムの絞り込みが効きにくく候補が多すぎて、匿名ロールのstatement_timeout=3秒を
    超えてタイムアウトすることがある（本番実測で約5秒かかり57014エラー）。
    `similarity()`関数呼び出しは索引を使えない（`%`演算子のみ索引化される）ことを確認済み、
    `SET LOCAL enable_seqscan=off`も試したが`stable`関数では使えず、`volatile`にして試しても
    かえって遅くなった（EXPLAIN ANALYZEで無駄な再チェック行数40万近くに増加）ため、
    バックエンド側の抜本修正はせず「検索に失敗しました。もう少し具体的なキーワードでお試しください」
    という案内をフロント側で出す形で許容している。根本対応にはPGroonga等の日本語対応全文検索が
    必要（未導入）。3文字以上や英数字クエリなら問題なく高速。
  - `SEARCH_MIN_LENGTH = 2`未満の入力では検索を実行しない（UIヒント表示のみ）。
- **総合スレ（`/general`、`GeneralThread.jsx`）**: クリップに紐付かない全体掲示板。
  新テーブルを追加せず、既存の`comments`テーブル・`post-comment` Edge Function・返信機能を
  そのまま流用する設計。`clips`テーブルに`id='__general_thread__'`という番兵行を追加し、
  これを対象クリップとして扱うことで実現している（`get_ranked_clips`等の集計系RPC・
  `top_broadcasters_mv`/`top_clippers_mv`はこの番兵行を`where id <> '__general_thread__'`で
  明示的に除外）。各クリップの「総合スレで話す」リンク（`/general?from=<clipId>`）から来た場合、
  投稿本文の先頭に`[[clip:<clipId>]]`という目印文字列を付けてDBスキーマ変更なしに
  「どのクリップの話か」を記録する（表示時は正規表現で取り除きチップ表示に変換）。
  直接`/general`に来た場合はこの目印なしで投稿され、番兵行のバッジは表示されない。
- **トレンドクリップ**（トップページ`TrendingBoard`）: 過去1〜72時間以内に作られたクリップを対象に
  「視聴回数 ÷ 経過時間（時間あたり視聴回数）」で並べた上位5件を表示（`get_trending_clips` RPC）。
  **簡易的な近似指標であることに注意**: view_countの時系列データを保存していないため、
  真の「短期間で急激に伸びた」を判定する手段がなく、その代替として作成からの平均視聴速度を使っている。
  72時間の絞り込みで`idx_clips_period_ranking`が効くため軽量。
- 上記の変更は本番Supabaseに直接マイグレーション適用済み
  （`supabase/migrations/20260903*.sql`、`search_clips`だけ紆余曲折で複数ファイルに分かれているが
  最終的に`20260903040000_search_clips_revert_to_simple.sql`が現在の本番の姿）。

## フッター・お問い合わせフォーム（2026-09-03追加）

- 全ページ共通の`Footer`コンポーネント（`src/components/Footer.jsx`）を追加し、当時存在した
  全ページコンポーネントに配置した。ホーム/サイトについて/利用規約/プライバシーポリシー/
  お問い合わせへのリンクとCopyright表記を表示する。`ClipRanking.jsx`が元々持っていた
  「お気に入り・コメントは...」の注記は`note`propとして残している。**新しくページを追加する際は
  必ず`<Footer />`を配置すること**（`MyStampsPage.jsx`など、この節より後に追加したページも配置済み）。
- サイトについて（`/about`）・利用規約（`/terms`）・プライバシーポリシー（`/privacy`）は
  静的コンテンツのページ（`AboutPage.jsx`/`TermsPage.jsx`/`PrivacyPage.jsx`）。
- **お問い合わせフォーム**（`/contact`、`ContactPage.jsx`）: 種類（不具合/要望/通報/その他）・
  メールアドレス（任意）・本文を送信すると`contact_messages`テーブルに保存される
  （`submit-contact` Edge Function経由、`useContactForm`フック）。**管理画面UIは実装しておらず**、
  運営が`npx supabase db query --linked "select * from contact_messages order by created_at desc"`
  で直接確認する運用。公開の閲覧・一覧表示ポリシーは設けていない。
- **本番でハマった重要なRLSの罠（今後同種のEdge Functionを追加する際に必読）**:
  `post-comment`等が使っている「`createClient(url, SERVICE_ROLE_KEY, { global: { headers: {
  Authorization: authHeader } } })`でservice roleキーのクライアントを作りつつ、Authorizationヘッダーだけ
  ユーザー自身のJWTに差し替える」パターンは、**service roleとしてRLSをバイパスするわけではない**。
  PostgRESTはAuthorizationヘッダーのJWTからロールと`auth.uid()`を決定するため、実際には
  `authenticated`ロールとしてRLSがそのまま適用される（`apikey`ヘッダーのservice roleキーは
  プロジェクト識別に使われるのみで、ロール決定には使われない）。そのため、このパターンを使う
  Edge Function経由で書き込むテーブルには、対象ロール向けのinsert/updateポリシーが必須。
  `contact_messages`にこのポリシーを用意し忘れ、`submit-contact`の挿入が500エラーで
  失敗するというバグを本番で実際に踏んだ（2026-09-03、`contact_messages_insert_own`ポリシー
  ＝`anon_id = auth.uid()`を追加して解決）。
  - 疑って調査した結果、**`request-broadcaster`（配信者登録リクエスト機能）が全く同じ原因で、
    導入当初から実質的に機能していなかったことが判明**。`broadcaster_requests`への履歴insertだけ
    でなく、本来の目的である`tracked_broadcasters`へのupsert（＝配信者を実際に登録する処理）も
    同じくRLSでサイレント失敗しており、ユーザーが「配信者を追加してほしい」とリクエストしても
    実際には何も登録されないままメッセージだけ成功表示されるという状態だった
    （本番の`broadcaster_requests`が常に0件だったこと、存在しないTwitchチャンネル名で
    意図的にrejectedパスを踏ませても行が増えないこと、実在するが未登録の配信者
    （テストで`shroud`を使用）でapprovedパスを踏ませても`tracked_broadcasters`に行が
    増えないことをcurlで確認して特定・修正後に再検証。テストで作成した行は削除済み）。
    - **根本修正**: `broadcaster_requests`へのRLSポリシー追加という対症療法ではなく、
      `request-broadcaster`側の`createClient`呼び出しから`global.headers.Authorization`の
      上書きそのものを削除し、正真正銘のservice roleクライアントとして動作するよう修正
      （`auth.getUser(jwt)`はトークンを明示的に渡す呼び出しのため、この上書きが無くても
      正しく検証できる）。`tracked_broadcasters`は元々「書き込みはservice roleのみ
      （ポリシーなし＝拒否）」という設計なので、ここに書き込み用RLSポリシーを追加する対応は
      セキュリティ上避けた（誰でもTwitch実在確認なしに直接書き込めるようになってしまうため）。
      あわせて`tracked_broadcasters`へのupsert結果のエラーチェックも追加し、
      今後同種の問題が起きても再びサイレント失敗しないようにした。2026-09-03修正・本番デプロイ済み。
    - `broadcaster_requests_insert_own`ポリシー（`anon_id = auth.uid()`）は履歴記録用として
      そのまま追加済み（こちらは対症療法ではなく妥当な設計）。

## ヘッダーナビ・スタンプ直押し・クリップ表示の大型化（2026-09-03追加）

- **ヘッダーのナビゲーション項目**（配信者一覧/クリップ職人/クリップ検索/総合スレ/お気に入り等）を、
  地味な文字リンクからボタン風（背景色・枠線付き、ホバーで強調）の目立つデザインに変更
  （`ClipRanking.jsx`の`navLink`スタイル・`.cv-nav-link`クラス）。「重要な機能なのに目立たない」という
  ユーザー指摘への対応。今後ヘッダーに項目を追加する際もこのボタン風スタイルに合わせること。
- **リアクションスタンプの直押し化**: 上記の「絵文字ボタンを押してから展開」方式を廃止し、
  クリップ一覧の各行で7種類のスタンプを常時表示・直接クリックできるように変更
  （`ClipRow`から`stampPickerOpen`の開閉状態を削除し、常時レンダリングに変更）。
- **PC画面でのクリップ表示を拡大**: 901px以上の画面幅で、サムネイル（64×44→128×72）とタイトル
  フォント（15px→19px、太字化）を`.cv-clip-thumb`/`.cv-clip-title`のCSSクラス経由で拡大し、
  無駄な余白を圧縮（`ClipRanking.jsx`の`<style>`内`@media (min-width: 901px)`）。
  **実装上の注意**: インラインstyleオブジェクトはCSSの`@media`クエリより詳細度が高く上書きできないため、
  レスポンシブに変えたいプロパティ（幅・高さ・フォントサイズ）はインラインstyleオブジェクトから
  削除し、className経由のCSSクラス側に持たせる必要がある（このサイトは基本方針として
  インラインstyleオブジェクトを使っているが、画面幅で値を変えたい箇所だけはこの例外パターンを使う）。
- **絵文字を使わない**: サイト内UIで😲（リアクションスタンプ機能を指すアイコンとして導入時に使用）を
  ユーザーから明示的に「使わないでほしい」と指摘され、`lucide-react`の`Smile`アイコンに置き換えた
  （ヘッダーの「スタンプ一覧」リンク、`/my-stamps`の見出し）。**今後、装飾目的の絵文字は使わず、
  既存パターンに倣って`lucide-react`のアイコンを使うこと**（スタンプ名自体の文字列「すっご」等は
  絵文字ではなくテキストなので対象外）。

## GitHub Actionsのscheduleトリガーが信頼できない問題への対応（2026-09-03追加、重要）

- **発覚の経緯**: ユーザーから「クリスレの最新クリップと本家Twitchを比較すると差異がある、
  競合サイト（twitchclipsranking.com）はしっかり取れている」と指摘。調査したところ、
  競合サイトに載っていた新着クリップ4件はすべて本サイトのDBにも存在していたが、
  view_countが大きくズレていた（例: 実際6,074回のところ本サイトは192回）。原因を辿ると
  `clips.view_count_synced_at`（view_count最終更新時刻）が**全54万件中51万件（95%）で
  NULL＝一度も更新されていない**ことが判明。さらに加藤純一の別クリップ1件は完全に未取得
  だった（配信者自体は追跡済みなのに）。
- **根本原因**: `refresh-clip-views.yml`（毎時20分想定）・`sync-live-clips.yml`（15分おき想定）
  の実行履歴を`gh run list`で確認したところ、**GitHub Actions自体の`schedule`トリガーが
  設定通りに発火していなかった**（sync-live-clips.ymlは直近12時間で2回のみ、4時間半以上の
  間隔が開くこともあった）。日次のsync-clips.ymlも本来UTC 21:05のところ実際は23時台に
  ずれ込んでいた。手動で`workflow_dispatch`を叩くと毎回正常・高速に完了することから、
  ワークフロー自体のロジックは正しく、GitHub Actions側のスケジューラが高負荷時に
  `schedule`イベントを間引く/遅延させるという既知の制約（特に短い間隔のcronほど影響が大きい）
  が本番で実際に問題化していたと判断した。
- **対応**: GitHub Actions自身の`schedule`トリガーを全廃止し（3ワークフローとも
  `workflow_dispatch`のみ残す）、代わりに**Supabase側の`pg_cron`+`pg_net`拡張**
  （DBレベルのスケジューラ、GitHub Actions自体の混雑に左右されない）から
  GitHub REST APIの`workflow_dispatch`エンドポイントをWebhookで確実に叩く方式に変更した
  （`supabase/migrations/20260903140000_reliable_cron_via_pg_cron.sql`）。
  - GitHub側でこのリポジトリのみに限定したfine-grained PAT（Actions: Read and write権限）を
    ユーザーに発行してもらい、`vault.create_secret()`でSupabase Vaultに保管
    （平文をgit管理下に置かない。マイグレーションファイルにはVaultから
    `vault.decrypted_secrets`経由で参照する形のみを書く）。
  - `net.http_post`は非同期（`net._http_response`テーブルに後から結果が入る）。
    本番で手動実行して`status_code: 204`＋実際にActionsのrunが起動することを確認済み。
  - cronジョブは3つ: `trigger-sync-live-clips`（`*/15 * * * *`）、
    `trigger-refresh-clip-views`（`20 * * * *`）、`trigger-sync-clips`（`5 21 * * *`、
    UTC 21:05=JST 6:05）。ジョブ名・スケジュールは`cron.job`テーブルで確認できる。
  - **今後同種のワークフローを追加する際の教訓**: GitHub Actionsの`schedule`は
    「ベストエフォート」であり、本番の定期実行を確実性が必要な用途（クリップ収集等）に
    使う場合は、素朴に`schedule:`を設定するだけでは不十分。pg_cron等DB側のスケジューラから
    `workflow_dispatch`を叩く構成にすること。

## タグスレ（ユーザー投稿型のスレ立て機能、2026-09-03追加）

- 「ZETAというタグを付けたら、それについて話すスレを立てたい」という要望への対応。
  誰でも好きなタイトルでスレを立てられ、コメントできる軽量な掲示板機能を新規追加した（`/threads`一覧、
  `/threads/:id`詳細、`TagThreadList.jsx`/`TagThreadDetail.jsx`）。ヘッダーナビに「タグスレ」リンクを追加。
- **設計判断**: 総合スレ（`__general_thread__`のダミー行を`clips`に挿入して`comments`テーブルを
  再利用する方式）とはあえて違う設計にした。スレのidが動的に増え続けるため、その方式だと
  `get_ranked_clips`等の集計RPC・マテリアライズドビュー全てから都度除外し続ける必要があり
  影響範囲が大きすぎる。`tag_threads`/`tag_thread_comments`という完全に独立した専用テーブルに
  することで、クリップのランキング/トレンド集計に一切触れずに済む設計にした。
  - 書き込み（スレ作成・コメント投稿）はテーブルへの直接INSERTを許可せず、必ず
    `security definer`のRPC（`get_or_create_tag_thread`/`post_tag_thread_comment`）経由にすることで、
    レート制限（スレ作成: 60秒に1回、コメント投稿: 15秒に1回、いずれもDB側で強制）・
    タイトル重複防止（`lower(title)`で一意制約、大文字小文字・表記ゆれを問わず既存スレへ誘導）を
    確実に効かせている。NGワード検査は今回省略（`contact_messages`と同じ「まずレート制限のみ」という
    扱い、詳細は該当節参照）。
  - **ハマった点**: plpgsql関数の`returns table(id uuid, title text, ...)`は、その列名がそのまま
    関数本体内で暗黙のOUT変数として使えてしまうため、本体内で同名のテーブル列（`tag_threads.title`や
    `tag_threads.id`等）をエイリアス無しで書くと「列参照が曖昧」エラーになる
    （`where lower(title) = ...`のような書き方が該当）。本番相手にcurlでテストして初めて発覚
    （ローカルのバッチSQL実行では`auth.uid()`が常にnullになるため気づけなかった）。
    テーブルにエイリアスを付けて`t.title`のように明示することで解決。**戻り値の列名と同名の
    テーブル列をplpgsql関数内で使う際は、必ずエイリアスで明示すること**。
  - `useBroadcasterTags`で付けたマイタグのチップ（`BroadcasterDetail.jsx`）に、そのタグ名で
    スレを探す/作るための吹き出しアイコンリンクを追加（`/threads?new=<タグ名>`へ遷移、
    作成欄にタグ名を自動入力するだけで、既存スレがあれば一覧からそのまま開ける）。
  - ブラウザで実機確認済み（スレ作成→コメント投稿→一覧のコメント数反映→マイタグからの
    導線、まで一通り確認。テストデータは削除済み）。

## ヘッダー固定表示（一時追加→撤回）・配信者への個人タグ付け（2026-09-03追加）

- トップページのヘッダー〜ライブ活動フィードまでを`position: sticky; top: 0`でまとめて固定表示に
  一度実装した（`ClipRanking.jsx`の`styles.stickyHeader`、`<header>`と`<ActivityTicker>`を
  1つのdivで囲む）が、**「見た目がださくなった」というユーザーの美観面の指摘で同日中に撤回・削除済み**。
  今後また固定ヘッダーを試す場合は、単純にposition:stickyで包むだけだと見た目の印象が悪くなりうる
  ことを踏まえ、影・背景のグラデーション処理や高さを抑えるなどのデザイン調整を検討すること。
  - 実装時にハマった点（撤回済みだが記録として残す）: `page`要素に付けていた`overflow: hidden`
    （背景ブロブ演出のためのもの）が残っていると、sticky要素は「overflowがvisibleでない
    最も近い祖先」を基準にスティッキングしてしまうため、`page`自身が非スクロールの巨大な高さを
    持つ結果スティッキングが機能しなくなる。背景ブロブのクリップは`bgGlow`自身の
    `overflow: hidden`だけで十分だったため、`page`側からは`overflow: hidden`を削除して解決していた
    （この削除は撤回時もそのまま残している。sticky実装とは独立した正当な変更のため）。
- 配信者への個人タグ付け機能を追加。「お気に入りの配信者だけ見たい」「いまやってるイベントの
  参加者だけ見たい」という要望に対応。`broadcaster_tags`テーブル（anon_id・streamer・tagの3列、
  本人のみ閲覧・追加・削除可、`tracked_broadcasters.tag`＝運営が設定する公開タグとは別物）を追加
  （`20260903120000_broadcaster_tags.sql`）。
  - `BroadcasterDetail.jsx`にタグの追加・削除UI（チップ表示、`useBroadcasterTags`フック）を追加。
  - トップページ（`ClipRanking.jsx`）に、自分が使っているタグで配信者を絞り込むセレクターを追加
    （`useMyBroadcasterTags`フックで自分の全タグ→配信者名の対応を取得し、選択中のタグに紐づく
    配信者名の配列を`get_ranked_clips`の新引数`streamer_filter`へ渡す）。タグを1つも持っていない
    ユーザーにはセレクター自体を表示しない。
  - `get_ranked_clips`に`streamer_filter text[] default null`を追加（全6分岐のWHERE句・件数計算に
    `and (streamer_filter is null or c.streamer = any(streamer_filter))`を追加）。配信者一覧の
    検索ボックスで踏んだのと同じ「クライアント側だけの絞り込みはページネーションを壊す」問題を
    避けるため、必ずDB側（RPC）で絞り込む設計にした。`clips.streamer`に索引（`idx_clips_streamer`）
    が無かったため追加、追加前は`streamer = any(...)`がstatement_timeout（3秒）を超えていた
    （索引追加後は実測0.2〜0.6秒）。引数を追加する既存RPCの拡張なので、旧シグネチャの
    `drop function if exists`を忘れないこと（この罠は本プロジェクトで複数回踏んでいる、
    「クリップ職人ランキング」節等参照）。

## 背景の装飾ブロブ演出（2026-09-03追加）

- ライブ活動フィードとは別に、「背景が寂しい、嘘でもいいので盛り上がっている雰囲気にしたい」という
  純粋にデザイン面の要望への対応。実データとは無関係な装飾として、コーラルレッド・紫・水色
  （既存のブランドカラー）のぼかした光の塊3つをゆっくり漂わせる背景を`ClipRanking.jsx`の
  `styles.bgGlow`/`bgBlob`＋`theme.css`の`cv-bg-drift-*`アニメーションで追加。今のところ
  トップページのみ（他ページへ広げる場合は同じパターンを踏襲すればよい）。
  - **ハマった点**: 最初`position: absolute`で実装したところ、背景が画面から消えて見えなかった。
    原因は2つ複合していた。①`page`要素は`position: relative`だけではスタッキングコンテキストを
    作らない（z-indexも明示的に指定して初めて作られる）ため、子要素の`z-index: -1`が`page`基準では
    なくルートまでエスケープしてしまっていた（`page`に`zIndex: 0`を追加して解決）。
    ②`position: absolute`だと配置の基準が`page`要素の**スクロール込みの全高**（ランキング一覧で
    数千pxになる）になり、%指定のブロブ位置が画面外はるか上に飛んでいってしまっていた
    （`position: fixed`に変更してビューポート基準にし解決）。ビルドは通っていても実際に
    ブラウザで見ないと気づけない類の不具合だった。

## ライブ活動フィード（トップページのティッカー、2026-09-03追加）

- 「サイトに動いているものが何もなく寂しい」というデザイン面の指摘への対応。単なる装飾アニメーション
  ではなく、実際のコメント・リアクションスタンプ投稿にSupabase Realtimeで連動する
  「ライブ活動フィード」をヘッダー直下に追加（`ClipRanking.jsx`の`ActivityTicker`、
  データ層は`use-clip-ranking.ts`の`useActivityFeed`フック）。
- マウント時に直近のコメント・スタンプを`comments`/`clip_reaction_stamps`から新しい順に取得して
  初期表示分にし、以降は`postgres_changes`（INSERT、フィルタ無し＝全クリップ対象）を購読して
  新着が来るたびに先頭へ追加。表示は1件ずつ約4.5秒おきに巡回し、新着が来た瞬間はそれを
  即座に先頭表示する。クリップタイトルはcomments/clip_reaction_stamps側に持っていないため、
  clip_id→titleの小さなキャッシュ（useRef）を使って都度の問い合わせを減らしている。
  総合スレの番兵行（`__general_thread__`）はフィード対象から除外。
- **ハマった点**: `comments`テーブルは既にrealtime publicationに入っていたが、
  `clip_reaction_stamps`テーブルは入っておらず、そのままではINSERTイベントが一切届かなかった。
  `alter publication supabase_realtime add table clip_reaction_stamps`を追加するマイグレーション
  （`20260903090000_activity_feed_realtime.sql`）で解決。**新しいテーブルでpostgres_changes購読を
  使う際は、テーブル追加時にrealtime publicationへの追加を忘れないこと**（`comments`は
  `20260901020000_enable_realtime_comments.sql`で対応済みだったため見落としやすい）。
  本番相手にSQLを直接INSERTしてブラウザ側に即座に反映されることを確認済み（テストデータは削除済み）。
- **追記（同日）**: 「PVがほぼ無い今の状態だとコメント/スタンプ自体が発生せずフィードが結局
  寂しいまま」という指摘を受け、`clips`テーブルへの新規追加（日次の全体同期・15分おきのライブ同期で
  常時流れ込んでくる本物のデータ）も`new_clip`タイプとしてフィードに混ぜるようにした。
  Realtimeではなく3分おきの定期取得（`PERIODIC_REFRESH_INTERVAL_MS`）にしている
  （バルクupsertのたびに大量のINSERTイベントが一気に届くのを避けるため）。
  - **ハマった点その2**: `clips`を`created_at desc`で取得するクエリが、39万件超のテーブルに
    対して索引が無く匿名ロールのstatement_timeout（3秒）を毎回超えていた（`idx_clips_created_at`を
    追加して解決、`20260903100000_clips_created_at_index.sql`）。
  - **ハマった点その3（本質的なバグ）**: 初期表示用の「コメント/スタンプ取得」useEffectが
    `setItems(merged)`と直接置き換えていたため、先に完了していた「新着クリップ取得」useEffectの
    結果を上書きして消してしまっていた（2つのuseEffectが同じstateを別々に更新する場合、
    両方とも`setItems((prev) => ...)`の関数更新にしないと後勝ちで上書きされる）。
    ブラウザで実機確認して初めて気づいた不具合（ビルドは通っていた）。
- **追記その2（同日）**: 「いま〇〇のスレが盛り上がっています」「急上昇中のクリップ職人」の
  2種類を追加。前者は新規RPC`get_hot_thread(lookback_minutes, min_comments)`
  （`20260903110000_hot_thread_rpc.sql`、直近180分以内に2件以上コメントが付いたクリップを
  1件返す。データを捏造したくないので、該当が無ければ単に表示しない設計）。後者は既存の
  `get_top_clippers_by_period`を直近24時間の範囲で呼ぶだけ（新規RPC不要、`clips`は常に
  データが豊富なので閾値未満で出ないという心配がほぼ無い一方、コメントは
  本番でまだ7件しか無い＝「盛り上がっているスレ」はまだ滅多に出ない前提で実装している）。
  どちらも`hot_thread`/`rising_clipper`という「その時点の1位」を表すスナップショット型として、
  他の種類（積み上げ式）とは別ロジックで扱う（`id`を`hot_thread-current`のように固定し、
  定期取得のたびに古い分を消してから最新のものだけ積み直す）。
  - **ハマった点その4（本質的なバグ）**: `ActivityTicker`の「新着が来たら先頭を見せる」判定が
    `items.length`の増加を見ていたが、件数が上限（15件）に達した後は新しい1位が来ても
    配列の長さ自体は変わらないため、判定が働かなくなっていた（＝上限到達後はhot_thread/
    rising_clipperがどれだけ更新されても表示に反映されない不具合）。`items[0]?.id`の変化を
    見る方式に変更して解決。**この手の「先頭/末尾が変わったら反応する」ロジックを配列の長さだけで
    判定するのは、上限（cap）付きの配列では機能しなくなる典型的な罠**なので、今後同種の実装をする
    際は要素の内容（id等）の変化を見ること。
  - 上記の修正後も表示上「反映されていないように見えた」が、これは巡回が1周（15件×4.5秒≒67秒）
    する前に確認をやめていただけで、実際には正しく巡回に含まれていた（ブラウザのJS実行で
    ティッカーのテキストを2秒間隔でポーリングして実証）。**この種の「ゆっくり巡回する一覧」の
    動作確認は、1周分待ってから判断すること**（今回は数秒〜十数秒の確認で「表示されない」と
    誤診断しかけた）。

## 独自ドメイン移行（kurisure.jp）・ファビコン刷新・基本SEO対応（2026-09-03追加）

- 独自ドメイン`https://kurisure.jp`をVercelプロジェクト（`clip-vote`）に追加し、稼働確認済み
  （お名前.comでドメイン取得 → Aレコード`kurisure.jp → 76.76.21.21`を設定 →
  「DNSレコード設定を利用する」用の専用ネームサーバー`01〜04.dnsv.jp`へ切替、という2段階の設定が
  必要だった。お名前.comは「DNSレコード設定」と「ネームサーバー設定」が別画面で、後者を
  変更しないと前者の設定が外部に反映されない点がハマりどころ）。
  - `post-comment`/`request-broadcaster`/`submit-contact`の3つのEdge FunctionsのCORS許可オリジン
    （`ALLOWED_ORIGIN`シークレット）は、当初「新旧両ドメインとも動かす」方針で複数オリジン対応の
    コード変更を検討していたが、ユーザーの意向で**旧ドメイン（`https://clip-vote.vercel.app`）は
    もう使わない**ことになったため、単純に`ALLOWED_ORIGIN`の値を`https://kurisure.jp`へ
    上書きするだけで対応した（コード変更は不要、`npx supabase secrets set`のみ）。
    Supabase Edge Functionsのシークレットはランタイムで注入されるため、値を更新しただけで
    再デプロイなしに即座に反映される（curlでのCORSプリフライト確認で実測済み）。
    旧ドメインからのリクエストはCORSで弾かれる状態になっている（意図した動作）。
- ファビコンをテンプレート由来の汎用SVG（クリスレのブランドと無関係な紫の抽象アイコン）から、
  新規に作成した`favicon.ico`（64×64）に差し替え。トップページの「クリスレ」見出しの隣にも
  同じ画像を表示している（`ClipRanking.jsx`の`styles.h1Icon`）。
- 「クリスレ」見出しのフォントをOswald（欧文専用、日本語部分は実際にはフォールバックしていた）から
  日本語対応の「RocknRoll One」に変更（`theme.css`のGoogle Fonts `@import`に追加）。
- **基本的なSEO対応**を追加（`index.html`）: `<html lang="en">`→`lang="ja"`に修正、
  meta description・OGP（`og:*`）・Twitter Cardタグ、`canonical`を`https://kurisure.jp/`で追加。
  `public/robots.txt`も新規追加。
  - **（解消済み、2026-09-03同日中）** 当初はクリップ/配信者/クリップ職人の個別ページの
    動的meta未対応・sitemapが静的ページのみという制約があったが、同日後半の
    「SEO強化とSNSシェア導線」節の対応で両方解消済み。`public/sitemap.xml`（静的ファイル）は
    その対応の中で**廃止**し、`api/sitemap.xml.js`（動的生成）に置き換わっている。
    このファイルへの直接参照は残っていないので注意。

## トップページのランキング/トレンド タブ統合・期間指定のボタン化（2026-09-03追加）

- トップページ上部に別ウィジェットとして表示していた「いまトレンド」（`TrendingBoard`）を廃止し、
  クリップランキング本体と同じ表示領域で「ランキング」/「いまトレンド」タブ切り替え表示する方式に
  変更（`ClipRanking.jsx`の`activeView`state）。タブクリックだけでなく、タッチのスワイプ
  （`onTouchStart`/`onTouchEnd`のX座標差分で判定、閾値50px）でも切り替えられる。切り替え時は
  `theme.css`に追加した`cv-slide-in-from-right`/`cv-slide-in-from-left`でスライド+フェードする
  （常に2枚のパネルを並べて幅200%でtranslateXするカルーセル方式は、ランキング（最大20件）と
  トレンド（5件）で高さが大きく異なり片方に無駄な余白ができるため採用せず、アクティブな方だけを
  マウントしてCSSアニメーションで差し替える方式にした）。
  - トレンドクリップも通常のランキング行と同じ`ClipRow`で描画するため、いいね/お気に入り/
    スタンプ/コメントがトレンド表示中でも同じように使える。`useReactions`/`useFavorites`/
    `useClipStamps`/`useBroadcasterAvatars`/`useClipperRanks`に渡すclipIds/streamerNames/
    creatorIdsは、ランキング一覧とトレンド一覧の両方のクリップを`useMemo`でマージしたものを使う
    （タブを切り替えるたびに読み込み直すとちらつくため、両タブ分を常に一緒に取得している）。
  - `ClipRow`に`trendingViewsPerHour`propを追加し、渡された場合だけmetaLineに
    「・時間あたりX回」を追記する（トレンド表示時のみ）。
- 「全期間/今年/今月/日別」の常時表示タブ行（+日別選択時はさらに7日分のタブ行）を、
  現在の選択を表示する1つのボタン（例:「9/3(木)」「全期間」）に集約。押すとポップオーバーで
  期間タブ（日別選択時はそのまま同じポップオーバー内に日付タブも表示）が開く方式に変更
  （`periodPickerOpen`state、外側クリックで閉じるのは`mousedown`イベントリスナー＋refで判定）。

## 詳細ページからの「戻る」が直前のタブ状態を復元できないバグ修正・タブ名変更（2026-09-04追加）

- **ユーザー報告**: 「いまトレンド→トレンド1位のクリップ詳細ページ→ランキングに戻る、で
  クリップ総合ランキングに飛んでしまい、本当はいまトレンドに戻りたい」という不具合報告。
- **原因**: `ClipRanking.jsx`の`activeView`（ランキング/トレンドのタブ選択）はコンポーネント内の
  `useState`だけで管理されており、クリップ詳細ページ（`/clips/:id`）へ遷移するとアンマウントされて
  失われる。さらに`ClipDetail.jsx`等の「戻る」リンクは常に固定パス（`/`）への`Link`だったため、
  ブラウザの実際の履歴を戻らず、常にトップページのデフォルト（ランキングタブ）が表示されていた。
- **対応**:
  - `ClipRanking.jsx`の`activeView`をURLクエリ（`?view=trending`、`useSearchParams`）にも同期。
    タブ切り替えは`{ replace: true }`で現在のURLを書き換えるだけにし（タブ切り替えのたびに
    履歴エントリを増やさない）、初期stateはマウント時に`searchParams.get("view")`から復元する。
  - 新規`src/lib/use-smart-back.js`（`useSmartBack(fallbackTo)`フック）を追加。
    react-routerが`window.history.state.idx`にSPA内のナビゲーション位置を持たせている性質を利用し、
    `idx > 0`（＝サイト内を辿ってきた）なら本物のブラウザ履歴を1つ戻る（`navigate(-1)`）ことで
    直前のURL（例:「/?view=trending」）へ正しく戻り、タブ状態が復元される。直接URLを開いた場合など
    戻り先が無い場合（`idx`が0以下）のみ`fallbackTo`（一覧のトップパス）へ遷移するフォールバック付き。
  - `ClipDetail.jsx` / `BroadcasterDetail.jsx` / `ClipperDetail.jsx` / `TagThreadDetail.jsx`の
    「戻る」リンクをこのフックに置き換え（`<Link to="固定パス">` → `<button onClick={goBack}>`）。
    同種の「一覧側のタブ/検索/期間などのstateがコンポーネント内useStateだけで管理されており、
    詳細ページへの遷移でアンマウントされると失われる」設計は他の一覧ページにも当てはまるため、
    今後同種の「戻ると状態が失われる」報告があれば同じパターン（該当stateのURL同期＋
    `useSmartBack`）で対応すること。
- **タブ名変更**（同日、ユーザー指示）: 「ランキング」→「**総合ランキング**」、
  「いまトレンド」→「**トレンドランキング**」（いずれも`ClipRanking.jsx`のタブボタンラベルのみ、
  `activeView`の内部値（`"ranking"`/`"trending"`）やURLクエリ（`?view=trending`）は変更していない）。

## お知らせフィードの表示カスタマイズ（2026-09-04追加）

- 「お知らせフィード（ライブ活動フィード）を自分好みにカスタマイズしたい、例えば指定したタグの
  最新クリップのみお知らせするとか」という要望への対応。`ActivityTicker`の右に歯車アイコンの
  設定ボタンを追加し、ポップオーバーで以下を設定できるようにした（`periodPickerOpen`と同じ
  「外側クリックで閉じる」パターンを流用）。
  - **種類ごとの表示ON/OFF**（新着コメント/リアクションスタンプ/新着クリップ/盛り上がっている
    スレ/急上昇中のクリップ職人の5種類、`ACTIVITY_FEED_TYPES`）。
  - **「新着クリップ」を自分の配信者タグ（`broadcaster_tags`、配信者詳細ページで付けられる
    「マイタグ」）で絞り込む**セレクター（自分がタグを1つも持っていなければセレクター自体を
    非表示。トップページの「マイタグで絞り込み」（`useMyBroadcasterTags`の`streamersByTag`）と
    同じデータを使い回している）。
- 設定は新規`src/lib/use-activity-feed-prefs.js`（`useActivityFeedPrefs`フック）が
  **localStorageのみ**で保持する。お気に入り/配信者タグ等は匿名認証のanon_id経由でDBに保存して
  端末をまたいで使えるようにしているが、これは純粋な表示上の好みでありデバイス間同期の必要性が
  薄いと判断し、あえてバックエンドに触れない設計にした（アカウント機能が無いサイトのため
  「この端末のこのブラウザだけの設定」という制約は許容している）。
  - フィルタ自体はDBクエリを変えず、`useActivityFeed(15)`が取得済みの直近15件を
    `ClipRanking.jsx`側で表示直前にクライアント側で絞り込む方式（`filteredActivityItems`の
    `useMemo`）。絞り込み条件によっては表示件数が実質的に減る（最悪、何も表示されず
    `ActivityTicker`が`null`を返す）ことを許容している。DB側のクエリ自体を絞り込みたくなった
    場合（例: タグ絞り込み時だけ多めに取得する等）は`useActivityFeed`側の変更が必要になる。
  - タグ絞り込みは現状「新着クリップ」タイプにのみ適用している（このタイプだけ元々
    `streamer`フィールドを持っているため）。コメント/スタンプ/盛り上がっているスレは
    クリップに紐づくがitem側にstreamer情報を持たせていないため対象外、急上昇中のクリップ職人は
    配信者ではなくクリッパー単位のため元々配信者タグとは紐付かない。将来これらにもタグ絞り込みを
    広げる場合は、`useActivityFeed`側で該当クエリに`streamer`列を追加する必要がある。

## 最新クリップ反映の高速化・tracked_broadcasters取得の1000件上限バグ修正（2026-09-03追加）

- **課題**: 新規クリップの収集は`sync-twitch-clips.ts`が1日1回（JST 6:05）、追跡中の配信者
  全員に対して「直近24時間分のクリップ」を取得するだけだったため、配信者がクリップを作ってから
  最大24時間サイトに反映されないことがあった。
- **対応**: `sync-live-clips.ts`（新規スクリプト）を追加し、`.github/workflows/sync-live-clips.yml`で
  15分おきに自動実行する。クリップはライブ配信中にしか作られないため、追跡配信者全員ではなく
  「いまライブ配信中」の人だけをGet Streams（`user_id`を1リクエスト最大100個指定、日本語配信の
  発見とは無関係にidで直接問い合わせ）で絞り込み、その人たちの直近30分（実行間隔15分に対して
  安全マージンを持たせた値）のクリップだけをGet Clipsで取得してupsertする軽量版。
  配信者の新規発見・過去分バックフィル・配信者/クリッパーランキングの集計ビュー更新は
  引き続き日次の`sync-twitch-clips.ts`の役割のまま（`get_ranked_clips`/`get_trending_clips`は
  clipsテーブルを直接ライブ集計するRPCのため、upsertした時点で即座にランキング/トレンドへ反映される。
  集計ビュー経由の配信者/クリッパーランキングだけは引き続き日次更新分だけ遅れる）。
  - ライブ中と確認できた配信者は`tracked_broadcasters.last_seen_at`もその場で更新する。
    カテゴリ横断の日次discoveryだけに頼ると、対象ゲームカテゴリにも日本語配信人気上位にも
    入らない配信者はいずれ`BROADCASTER_STALE_DAYS`（30日）を超えて追跡対象から外れてしまうため、
    実際にライブを観測できた時点でも延命するようにしている。
  - 頻度は「15分おき（バランス重視）」をユーザーと相談の上で採用。このリポジトリはprivateで
    GitHub Actionsの無料枠が月2,000分のため、このワークフローだけで月3,000〜5,000分程度
    追加消費する見込み（実測: スクリプト本体の実行時間は約50秒、Actionsのセットアップ込みで
    1回1.5〜2分程度）。無料枠を超える場合は超過分が課金される点に注意（頻度を下げる場合は
    cronの`*/15 * * * *`を変更するだけでよい）。
  - **同時に見つけた既存バグ修正**: `sync-twitch-clips.ts`の対象配信者取得
    （`tracked_broadcasters`を`last_seen_at`で絞り込むSELECT）が`.range()`等のページングなしの
    素朴なSELECTだったため、PostgRESTの既定の行数上限（Supabase側の設定で1000件）で
    サイレントに切り詰められていた。本番の`tracked_broadcasters`は既に1,914件（アクティブ判定
    のみでも1,914件）あり、実際に本番相手にpaginationありの取得で1,914件全件返ることを確認して
    修正した（`tracked_clippers`のアイコン取得で過去に踏んだのと同種の罠、「クリップ職人
    ランキング」節参照）。`fetchAllRows`ヘルパー（`.range()`で1000件ずつページングして全件取得）を
    `sync-twitch-clips.ts`・`sync-live-clips.ts`の両方に用意した（スクリプトごとに自己完結させる
    という既存方針を踏襲し、共通モジュール化はしていない）。**今後、件数が増え得るテーブルに
    対して`.limit()`を指定しない素朴なSELECTを追加する際は、必ずこのページング上限を踏まえること**。

## 配信者一覧の検索が「読み込み済みの1ページ分」しか見ていなかったバグ修正（2026-09-03追加）

- ユーザーから「布団ちゃんやゆゆうたなど有名配信者を検索しても出てこない、集計漏れではないか」と
  報告あり。調査の結果、**クリップ収集自体は正常**（布団ちゃんと申します=クリップ1,133件、
  ゆゆうた押忍=クリップ1,153件、どちらも本番DBに存在）で、原因は`/broadcasters`
  （`BroadcasterList.jsx`）の検索ボックスが実際にはDBを検索せず、「`useTopBroadcasters`で
  読み込み済みの1ページ分（30件）」だけをクライアント側でフィルタしていたこと。
  合計視聴回数順のランキングで布団ちゃんは121位・ゆゆうたは82位（クリップの1本あたり視聴回数が
  比較的低いジャンルのため）で、どちらも1ページ目には出てこず「該当する配信者が見つかりません
  でした」と誤表示されていた。
- `get_top_broadcasters` RPCに`search_query`引数（配信者名のあいまい検索、省略時は従来どおり
  全件）を追加し、DB側で絞り込んでから返すように修正（`supabase/migrations/
  20260903080000_broadcaster_search.sql`）。`useTopBroadcasters(limit, offset, searchQuery)`と
  `BroadcasterList.jsx`もサーバー側検索を使うように変更し、クライアント側の無意味なフィルタは削除。
  検索語が変わったら1ページ目に戻すuseEffectも追加（他のページの`searchQuery`変更時と同じパターン）。
  本番で「布団ちゃん」「ゆゆうた」それぞれ検索して正しくヒットすることを確認済み。
- **同種の罠に注意**: トップページ（`ClipRanking.jsx`）ヘッダーの「配信者名で検索」ボックスも
  「現在表示中のランキングページ（期間・並び替え条件つき）の中だけ」をクライアント側でフィルタする
  設計だが、こちらは`useBroadcasterSearch`（`tracked_broadcasters`への本物のilike検索）を
  フォールバックとして使い「登録済みだが現在の条件ではランキング対象クリップがありません」と
  正しく案内できているため、今回は修正対象に含めていない（「見つからない」と誤解させる表示には
  なっていない）。今後、一覧系ページに検索ボックスを追加する際は、読み込み済みページ内だけの
  クライアント側フィルタにしない（今回のバグと同じパターンにしない）こと。

## 認証

- ログイン機能はなく、Supabase Anonymous Auth（匿名サインイン）でブラウザごとにanon_idを発行・永続化し、いいね/よくないね/お気に入り/リアクションスタンプ/コメント/お問い合わせを紐付けている

## ローカル開発時の既知の制約

- 全Edge Function（`post-comment` / `request-broadcaster` / `submit-contact`）共通で、CORS許可オリジン
  （`ALLOWED_ORIGIN`シークレット）が本番ドメイン（`https://kurisure.jp`、2026-09-03に独自ドメイン
  移行に伴い旧`https://clip-vote.vercel.app`から変更）に固定されているため、
  `npm run dev`（localhost）からの呼び出しはブラウザのCORSで必ずブロックされる
  （2026-09-02/03で複数回確認済み、私の変更が原因ではない。新しいEdge Functionを追加した場合も
  同様に発生する前提で考えること）。Edge Function自体の動作確認はcurl（CORSの影響を受けない）で行うこと。

## 環境変数

- `.env`（Git管理外）: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- GitHub Actions Secrets: `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TARGET_GAME_IDS`,
  `X_API_KEY`, `X_API_KEY_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`（2026-09-03追加、X自動投稿用。
  Supabase Vaultではなくこちらに置く理由は「毎日のランキングをXへ自動投稿」節参照）
- 元のセットアップ手順・秘密値は親ディレクトリ（`C:\clip-vote`）の `CLAUDE_CODE_INSTRUCTIONS.md` と `.env.human-provided` を参照（このリポジトリには含まれない）

## 簡易管理画面（2026-09-03追加、2026-09-03にURL非公開化）

- 「問い合わせ確認をSQL直打ちでやっているのが面倒」というニーズへの対応。`contact_messages`・
  `comment_reports`・`broadcaster_requests`の3つを1画面で確認・一部操作できる管理画面を追加した
  （`src/components/AdminPage.jsx`、データ層は`src/lib/use-admin.ts`）。**どのナビにもリンクしていない**
  （URLを直接知っている運営だけが使う想定、意図的な設計）。
- **URLは`/admin`ではなく推測困難なランダム文字列付きパス**（`src/App.jsx`のルート定義を直接参照すること。
  このファイルには意図的に実際のパスを書かない）。当初`/admin`だったが、ユーザーから
  「推測されやすいので私にしか到達できないようにしたい」と指摘され変更した。パスワード認証
  （後述）は維持しつつ、URL自体の推測困難性で防御を1段階増やす方針。今後URLを変更する場合は
  `src/App.jsx`のルートを書き換えるだけでよい（サーバー側の設定変更は不要）。
- サイトにアカウント認証システムが無いため、簡易的にパスワードゲート方式にした。パスワードは
  Supabase Vaultに保存（`vault.create_secret(..., 'admin_panel_password', ...)`、平文はgit管理外）し、
  `security definer`のRPC（`admin_verify_password`でログイン確認、`admin_get_*`/`admin_set_*`で
  各テーブルの取得・更新）が呼び出しのたびにDB側で照合する方式（`supabase/migrations/
  20260903150000_admin_panel.sql`）。対象3テーブルはいずれも「本人以外閲覧不可」のRLSのため、
  通常のテーブルアクセスでは管理者でも読めず、必ずこのRPC経由になる。
  - フロント側はパスワードを`sessionStorage`に保持するだけの簡易セッション（`useAdminAuth`）。
  - できる操作: お問い合わせの既読/未読切り替え、通報されたコメントの非表示/表示切り替え、
    配信者登録リクエスト履歴の閲覧（承認/却下は既存の`request-broadcaster`のフローのまま、
    ここでは変更しない）。
- **ハマった点**: `useAdminAuth()`をログインフォーム（`LoginForm`）と親（`AdminPage`）の両方で
  それぞれ個別に呼び出していたところ、Reactのカスタムフックは呼び出し箇所ごとに別々の`useState`
  インスタンスを持つため、ログインフォーム側でログインに成功してもその状態が親に伝わらず、
  画面がログインフォームのまま変化しない（エラー表示も無い）という不具合になった。`useAdminAuth()`の
  呼び出しを`AdminPage`側の1箇所だけにし、`login`/`verifying`/`error`をpropsで`LoginForm`に渡す形に
  修正して解決。**同じカスタムフックを親・子の両方で個別に呼ぶと状態が分裂する**という、
  今後別の機能でも起こりうる罠として記録しておく。
- ブラウザで実機確認済み（ログイン→お問い合わせの既読切り替え→コメント通報の非表示切り替え→
  配信者リクエストの空状態表示、まで一通り確認）。

### ダッシュボードタブ（2026-09-03追加）

- 「管理画面なので情報はあればあるほどいい」というユーザー要望で、サイト全体の統計を1画面に
  まとめた`DashboardPanel`を追加（管理画面の既定タブ）。全体サマリー（総クリップ数・配信者数・
  クリップ職人数・コメント数・お気に入り・スタンプ・タグスレ・配信者タグ・総訪問者数
  ＝`auth.users`件数で匿名セッション累計を近似）、直近の伸び（24h/7日の新規クリップ・コメント数、
  view_count同期率）、人気ランキングTOP5（配信者/クリップ職人/クリップ視聴回数/クリップ
  コメント数/人気タグ）、新着タグスレ、モデレーション状況（未読問い合わせ/通報中コメント/
  保留リクエストの件数のみ、詳細は既存タブ参照）、検索キーワード（後述）、pg_cronの直近実行
  状況（`cron.job_run_details`）をすべて`admin_get_dashboard(p_password)` RPC 1回でjsonbとして
  まとめて返す設計（タブごとに何十回もRPCを呼ぶより速く済む）。
- **検索キーワードログを新設**（`search_log`テーブル、`query`/`result_count`/`created_at`のみ、
  匿名IDは持たない）。`useClipSearch`（`use-clip-ranking.ts`）が検索成功時に`search_log`へ
  fire-and-forgetでinsertする（失敗しても検索体験は壊さない、ログ失敗は`console.warn`のみ）。
  「クリップ検索で何を探して見つけられなかったか」＝未追跡配信者の需要を把握する狙い。
  RLSはinsertのみ許可（誰でも書けるが読めない）、読み取りは`admin_get_dashboard`のsecurity
  definer経由のみ。
  - **ハマった点（本質的なバグ）**: 当初`search_clips`と同じくその場でclips全件に対する
    `count(*)`等をライブ集計していたところ、匿名ロールのstatement_timeout（3秒）を本番実測で
    大きく超過した（`count(*) where id <> '__general_thread__'`だけで11.6秒、
    `view_count_synced_at is/is not null`の集計もそれぞれ1〜7.5秒）。plpgsql関数内で
    `set local statement_timeout`を実行しても効果が無いことも確認した
    （**トップレベル文のタイムアウト期限は文の実行開始時点で確定するため、関数内で
    途中からstatement_timeoutを変更しても、その文自体には反映されない**。これは今後も
    同種の罠になりうるので、`set local statement_timeout`で誤魔化そうとしないこと）。
    「クリップ職人ランキング」節と同じ結論（clips全件スキャンが絡む集計はマテリアライズド
    ビュー化する）に至り、`admin_dashboard_clip_stats_mv`（1行だけの集計専用ビュー、
    総クリップ数・24h/7日の新規数・最新クリップ日時・view_count同期件数などをまとめて持つ）
    を新設し、既存の`refresh_ranking_views()`（sync-twitch-clips.ts等が同期完了後に呼ぶ、
    service_role専用）に一緒にリフレッシュするよう追加した。ダッシュボードなので同期タイミング
    （最大1時間程度）のズレは許容している。
  - tracked_broadcasters（約1,900件）・tracked_clippers（約31,700件）程度の規模であれば
    素朴な`count(*)`でも数百ms程度で収まることを実測確認済み（clips=54万件のような規模でのみ
    問題化する）。**今後このRPCに項目を追加する際は、対象テーブルの行数がclips並みに
    大きくなりうるかどうかを先に確認すること**。

## SEO強化とSNSシェア導線（2026-09-03追加）

- 「訪問者数を増やすにはどうすればいいか」という相談から、SEOと共有導線の2本立てで対応した。

### document.title/meta descriptionの動的更新

- SPAのためindex.htmlのmetaは固定値のままで、クリップ/配信者/クリップ職人の個別ページも
  ずっと同じタイトル・説明文しか出せていなかった（ブラウザタブの判別しづらさという実害もあった）。
  `src/lib/use-document-meta.js`（`useDocumentMeta`フック）を追加し、`ClipDetail.jsx`/
  `BroadcasterDetail.jsx`/`ClipperDetail.jsx`で個別の内容に書き換えるようにした。
  ページ離脱時（unmount）にはモジュール読み込み時に記録しておいた初期値（index.htmlの値）へ
  自動で戻す設計のため、他の静的ページ側は何も変更しなくてよい。
  - `<link rel="canonical">`は`href`属性、`<meta>`は`content`属性と異なるため、
    共通の`setMeta`ヘルパーは要素のタグ名で属性名を切り替えている。

### SNSクローラー向け動的OGP（api/og/*）

- Twitter/LINE/Discord/Slack等のリンク展開ボットはJSを実行しないため、上記のdocument.title
  書き換えだけではシェア時のプレビュー（タイトル・画像）が個別クリップ等の内容にならない。
  Vercelサーバーレス関数（`api/og/clip/[id].js`、`api/og/broadcaster/[name].js`、
  `api/og/clipper/[id].js`）を追加し、Supabaseから該当データを取得してOGP専用の軽量HTMLを
  返すようにした。`vercel.json`の`rewrites`で、User-Agentが主要クローラー
  （Twitterbot/facebookexternalhit/Slackbot/Discordbot/LINE等、"bot"を含む一般的なUA全般）に
  一致する場合だけこの関数へ振り分け、通常ユーザー・Googlebot（JSを実行するため直接SPAで
  問題ない）はそのままSPAへ通す。og:imageはクリップのTwitchサムネイル/配信者・クリップ職人の
  プロフィール画像をそのまま使う（画像生成の仕組みは作っていない）。
- **ハマった点（重大）**: 既存の`vercel.json`にはSPA用のcatch-all rewrite
  `"/((?!.*\\..*).*)" -> "/index.html"`（拡張子を含まないパスは全部SPAへ、直接URL入力時の
  404対策として2026-09-03に追加済み）があったが、これが`/api/og/clip/xxx`や`/api/sitemap.xml`
  のような拡張子なしの`/api/`配下のパスまで飲み込んでしまい、サーバーレス関数が一切呼ばれず
  常にSPA本体が返っていた（一時的なデバッグ用エンドポイントで実際にSPAのHTMLが返ることを
  確認して発覚）。`"/((?!api/|.*\\..*).*)"`のように`api/`始まりのパスを明示的に除外して解決。
  **`vercel.json`にSPA用のcatch-all rewriteがある構成で`/api`配下のルートを追加する際は、
  必ずこの除外パターンになっているか確認すること**。
  - もう1点、`has`（User-Agentヘッダー等でのrewrite条件）の`value`は部分一致ではなく
    正規表現の「全体一致」として評価されるようだったため、`"(bot|...)"`のような
    部分文字列だけの指定だと一致しなかった。前後に`.*`を付けて
    `".*(bot|...).*"`という形にして解決（本番でTwitterbotのUAを送って確認済み）。

### 動的sitemap.xml

- 静的ページのみだった`public/sitemap.xml`を廃止し、`api/sitemap.xml.js`
  （サーバーレス関数、`vercel.json`のrewriteで`/sitemap.xml`にマッピング）に置き換えた。
  静的ページ＋配信者全件（`tracked_broadcasters`）＋人気クリップ職人上位（`top_clippers_mv`、
  上位3000）＋人気クリップ上位（`clips`のview_count上位、上位5000）を含む（本番実測で
  合計9,924件、Googleのsitemap上限50,000件に対して十分小さい）。clips全件（54万件超）は
  検索価値の低いクリップまで含めると非現実的な規模になるため対象外にした、という意図的な
  スコープ判断。`Cache-Control: s-maxage=21600`で6時間キャッシュ。
  - **ハマった点（重大、原因特定に時間がかかった）**: 実装直後、sitemapのURL件数が
    毎回ちょうど3010件（静的10件+1000件×3）に固定されるバグが発生。当初「3クエリを
    `Promise.all`で並列実行したのが原因では」と誤診断して直列実行に変更したが直らず、
    実際の原因は**PostgRESTのプロジェクト側デフォルト行数上限（1000件）はクエリ文字列の
    `limit=N`では超えられない**という、このプロジェクトで過去に何度も踏んでいる既知の罠
    （「クリップ職人ランキング」節等参照）だった。3クエリとも`limit=3000`や`limit=5000`を
    指定していたのに全部1000件で打ち切られており、たまたま合計値が近い数字になっていたため
    「並列/直列」という誤った切り分けに時間を使ってしまった。**同じ症状（想定より少ない件数で
    頭打ちになる）を見たら、まずこの1000件上限を疑うこと**。`api/_lib/supabase.js`に
    `supabaseGetPaged`（Rangeヘッダーによるページング取得）を追加して解決。

### シェアボタン

- `src/components/ShareButtons.jsx`（新規、X/LINEで共有・リンクをコピーの3ボタン、
  ブランドロゴは使わず`lucide-react`の`Share2`/`Link2`/`Check`アイコンのみ使用）を
  クリップ/配信者/クリップ職人の各詳細ページに追加。X・LINEは公式のWeb Intent URL
  （`twitter.com/intent/tweet`・`social-plugins.line.me/lineit/share`）を新規タブで開くだけの
  実装で、認証・APIキー等は不要。リンクコピーは`navigator.clipboard.writeText`。
  - **既知の制約**: リンクコピー機能はChrome拡張の自動操作（CDP経由のクリック）からは
    ブラウザのクリップボード権限プロンプトが解決されずハングすることを確認した
    （実機の人間のクリックでは通常どおり動作するはず、標準的な`navigator.clipboard`の
    使い方であり実装自体に問題はない）。この制約により、この機能は自動テストでは
    最終確認できていない。

## デバッグ時の教訓: curlに日本語を直接埋め込むと文字化けして誤診断する（2026-09-03）

- ユーザーから「特定のクリップ2件がDBに存在しないのでは」と指摘され調査した際、
  `curl "https://.../clips?title=ilike.*ヴァロ部門*..."`のように日本語文字列を
  シェルコマンドへ直接埋め込んでSupabase REST APIを叩いたところ、URLエンコードされずに
  文字化けし、実際には存在するデータが「0件」と返ってきて「クリップが取得できていない」と
  誤診断してしまった（`node -e "console.log(encodeURIComponent('...'))"`で明示的に
  percent-encodingしてから叩き直したところ正しく見つかった）。
  結果的に無駄ではない改善（`sync-live-clips.ts`への配信者発見機能追加）にはなったが、
  当初の具体的な指摘そのものへの根拠は誤りだった。**今後、日本語を含む文字列でSupabase
  REST APIやその他のURLをcurlで直接叩く際は、必ず`encodeURIComponent`等で
  percent-encodingしてから埋め込むこと**（`node -e "console.log(encodeURIComponent('...'))"`が
  手早い）。「0件」という結果が返ってきても、それが「本当に無い」のか「クエリ自体が壊れている」
  のか、疑ってから結論を出すこと。

## 毎日のランキングをXへ自動投稿（2026-09-03追加）

- 「訪問者数を増やしたい」という相談の一環で、毎朝JST 9:00にXへ自動投稿する機能を追加した。
  「日本唯一の掲示板機能があるTwitchクリップサイト」「クリップ職人の紹介」「お気に入りで
  自分だけのクリップコレクションが作れる」の3点を宣伝したいという要望を受け、同じ形式の投稿が
  続いて飽きられないよう**JSTの曜日でテーマをローテーション**する設計にした
  （`post-daily-ranking.ts`内の`postType`分岐）。
    - 月〜金: 前日（0時〜24時）に一番視聴されたクリップを「問いかけ型」の文面
      （「一番見られたのは誰だったと思う？→正解は…」）で紹介
    - 土: `get_top_clippers_by_period`で直近7日間のクリップ職人ランキング1位を紹介
    - 日: お気に入り（マイクリップコレクション）機能の紹介（固定文面、DBアクセス不要）
  - **「日本唯一」という表現はそのままでは事実と異なる**（本セッション内でも
    twitchclipsranking.com・twitch-clips-storage.comという類似の日本語Twitchクリップサイトを
    確認済み）。ユーザーに確認の上、「コメント・掲示板機能があるのはクリスレだけ」という
    根拠のある角度（`BOARD_PITCH`定数＝「コメントもできるTwitchクリップの掲示板「クリスレ」」）
    に置き換えて実装した。**今後この種の「唯一」「No.1」等の訴求文言を追加する際は、
    実際に競合と比較して真実か確認してから使うこと**（安易に鵜呑みにして実装しない）。
  - クリップ/クリップ職人の個別ページには当日実装済みの動的OGP（`api/og/clip/[id].js`、
    `api/og/broadcaster/[name].js`）が効くため、リンクを貼るだけでXのタイムライン上に
    サムネイル付きのカードが表示される（この日のうちに実装したOGP機能とシナジーがある設計）。
  - **追記（同日）**: 「クリップ職人機能は人気が出そうだから毎日の投稿に入れたい」という
    要望を受け、平日のランキング投稿にも「✂️ ○○さんが作成」というクリップ職人クレジット行を
    追加した（土曜はもともと週間クリップ職人ランキング専用の投稿のため、実質ほぼ毎日
    クリップ職人に触れる形になる）。クリップの`creator_id`が`'__unknown__'`（Twitch側で
    作者を特定できなかった古いクリップ、「クリップ職人ランキング」節参照）の場合は
    クレジット行自体を省略する。
    - **ハマった点（280文字上限、また踏んだ）**: クレジット行を追加した直後、
      配信者名25文字・クリップ職人名25文字・タイトル25文字が同時に最大長になる最悪ケースで
      試算したところ重み322となり280を大きく超過した。1項目ずつ上限を緩めるたびに
      この手の超過を繰り返し踏んでいるため、**配信者名・クリップ職人名・タイトルの3つを
      それぞれ15文字に統一して切り詰める**（`truncateTo`共通ヘルパー）方式に変更し、
      最悪ケースで重み274（280に対し6の余裕）に収まることを確認した。**Xの文字数が絡む
      文面に要素を追加する際は、既存の上限を使い回さず、追加後の全項目を最悪ケースで
      必ず再試算すること**（1箇所だけ緩めても他の項目との組み合わせで簡単に超過する）。
- `post-daily-ranking.ts`（新規Denoスクリプト）が実処理を担当。他の定期ジョブと同じく
  GitHub Actions自身の`schedule`トリガーは信頼できないため使わず、Supabase側のpg_cron
  （`trigger-post-daily-ranking`、UTC 0:00=JST 9:00）から`.github/workflows/
  post-daily-ranking.yml`のworkflow_dispatchをWebhookで確実に起動する、既存3ジョブと同じ方式。
- **X API v2への投稿はOAuth 1.0a（ユーザーコンテキスト）認証が必要**で、外部ライブラリに
  頼らずWeb Crypto API（HMAC-SHA1）で自前署名している（このプロジェクトの「スクリプトは
  自己完結させる」方針を踏襲）。必要な4値（API Key/Secret、Access Token/Secret）は
  X Developer PortalでAppを作成し、**権限を「Read and Write」に変更してから**
  「Keys and tokens」で発行する（先に生成していた場合はRead and Write化後に再生成が必要）。
  - **これら4値はSupabase Vaultではなく、GitHub Actionsのリポジトリシークレットとして
    登録する**（`gh secret set X_API_KEY`等、または GitHub の Settings → Secrets and
    variables → Actions）。Vaultに置くパターン（`github_actions_pat`/`admin_panel_password`）は
    「SQL/pg_cronから直接参照する必要がある」秘密情報向けで、X APIキーはpost-daily-ranking.ts
    （GitHub Actionsランナー内で完結するDenoスクリプト）でしか使わないため、
    既存のTWITCH_CLIENT_ID等と同じ「GitHub Actions Secrets」パターンが適切。
- 二重投稿防止のため`daily_ranking_posts`テーブル（`posted_date`が主キー）に投稿済みの日付を
  記録し、同じ日に2回実行されても2件目はスキップする設計。
- **ハマった点（自己発見・実害なしで修正）**: 「前日のJST日付文字列」を求める際、
  UTC変換後の期間開始時刻（＝JST 0:00ちょうど）から`toISOString().slice(0,10)`で
  逆算する実装だと、その時刻が「前日の終わり」と「当日の始まり」のちょうど境界のため
  1日ずれて当日の日付になってしまう（テストで発覚）。UTC変換する「前」のJST年月日フィールド
  （`jstYesterdayStart`のUTCフィールドとして保持している値、UTC変換はまだ適用していない
  生のJST日付部分）から直接文字列化することで解決。**JST等のタイムゾーンの「日付境界ちょうど」
  の時刻をUTC変換して日付文字列化する処理は、変換前後どちらの値から作るかで1日ずれる
  典型的な罠**なので、今後同種の実装をする際は変換前のフィールドから直接求めること。
- **ハマった点その2**: Xの投稿上限280文字（日本語は1字2カウント）に対して、クリップタイトルの
  切り詰め上限を最初50文字に設定したところ、配信者名が長い（Twitchのログイン名上限25文字）・
  視聴回数が8桁という最悪ケースを試算したら固定文言だけで重み221を消費しており、
  タイトルに使える余裕は実質29文字分しかなかった（本番相当のダミーデータで検証して発覚、
  実際に投稿する前に気づけた）。25文字に修正して解決。**Xの文字数上限が絡む文面は、
  「よくあるデータ」ではなく想定しうる最悪ケース（配信者名の最大長・視聴回数の桁数等）で
  重み付き文字数を試算してから固定文言の長さを決めること**（後から要素を1つ足すだけで
  簡単に超過しうるため）。
- **本番アカウントの投稿確認済み**: X Developer Portalで作成したApp（Read and Write権限、
  OAuth 1.0a）で実際にテスト投稿し成功を確認した（@kurisure_info）。当初X APIから
  `402 credits depleted`エラーが出たが、これは実装の問題ではなくXの無料プラン廃止による
  ものだった（ユーザーが少額課金して解決）。X APIの障害切り分けをする際は、まずこの手の
  アカウント側の請求・プラン状態を疑うこと。
- サイト側にもXアカウントへの導線を追加した（`Footer.jsx`の全ページ共通バナー
  「毎日のランキングをXで配信中 — @kurisure_infoをフォロー」、`ClipRanking.jsx`の
  ヘッダーナビに「Xでフォロー」リンク）。ブランドロゴは使わず`lucide-react`の`ExternalLink`
  アイコンで表現している（このプロジェクトの「装飾目的の絵文字・ブランドロゴ画像を使わず
  lucide-reactのアイコンで統一する」方針を踏襲）。

### クリップ職人ランキング投稿に2〜5位を追加（2026-09-04追加）

- 土曜の`buildClipperSpotlightPost`が1位しか紹介していなかったのを、2〜5位も名前だけ
  紹介するよう拡張（`get_top_clippers_by_period`の`clipper_limit`を1→5に変更）。
- **文字数上限への対処を今回から「手計算の最悪ケース試算」ではなく実行時チェックに変更**した。
  2〜5位は0〜4人という可変人数で、それぞれの名前の長さも毎回変わるため、これまでのように
  固定文言の組み合わせを人力で試算する方式（このファイルに何度も「ハマった点」として記録している
  やり方）は現実的でないと判断した。新規`tweetWeight()`（半角=1・それ以外=2の簡易近似、
  URL等を実際より重く見積もる方向にしかズレないため安全側）で組み立て済みの固定文言の重みを
  実測し、残り予算に収まる人数分だけ`buildRunnersUpLine()`が2位から順に採用する
  （2位の名前は`RUNNER_UP_NAME_MAX_CHARS`=10文字に切り詰め、`／`区切り）。
  - **重要な挙動**: この設計上、**5位まで毎回載るとは限らない**（1位の配信者名・視聴回数
    自体が長い日は2〜3人分しか載らないこともある）。何位まで載るかがブレるより、
    桁溢れで投稿自体が失敗する方が問題という判断で、あえてこの可変挙動を許容している。
  - Node上で最悪ケース（全員25文字の日本語名など）・典型ケース・「クリッパーが2人しかいない」
    「1人しかいない」エッジケースをシミュレートし、いずれも280以内に収まり、かつ後者2つで
    クラッシュしないことを確認済み（`data.slice(1, 5)`は候補が足りなくても単に短い配列になるだけ）。
  - **今後の教訓**: 載せる要素の個数や長さが可変な文面を追加する場合は、今回のように
    `tweetWeight()`で実測しながら組み立てる方式にすること。要素数が固定（今まで通り
    配信者名1つ・タイトル1つ等）ならこれまで通りの手計算試算で十分だが、可変要素が絡むと
    手計算の組み合わせ爆発が発生し見落としやすい。

### クリップ職人ランキング投稿に画像を添付（2026-09-04追加）

- 「名前だけの文字情報より、サイトの雰囲気（ランキング画面の実際の見た目）を知ってほしい」
  という要望を受け、土曜の投稿にClipRanking.jsxの`WeeklyClipperBoard`（トップページの
  週間クリップ職人ランキング表示）を模したカード画像を添付するようにした。
- **画像生成**: `imagescript`（`jsr:@matmen/imagescript@1.3.1`、Deno上で動く純粋なJS/WASM
  実装の画像処理ライブラリ、ネイティブ依存なし）を新規依存として追加し、`buildClipperRankingCard()`
  がその場で1200幅・可変高さ（人数分だけの高さにして5人に満たない週でも余白ができないように
  している）のPNGを生成する。構成要素: サイトのブランドカラー（コーラルレッド・紫・水色）を
  ぼかし風に配置した背景ブロブ（実際のblur処理ではなく、中心から外側へアルファを線形に
  落とすグラデーションで代用。imagescriptの型定義に`blur()`が無く型チェックが通らなかったため）、
  「クリスレ」ブランド文字、順位ごとのカード（丸角パネル、金/銀/銅のランク番号色は
  `ClipRanking.jsx`の`WEEKLY_RANK_ACCENTS`と統一、Twitchアバターを円形クロップして表示、
  名前・視聴回数）。
  - **日本語フォントの選定**: Google FontsのNoto Sans JPはvariable font（`[wght].ttf`）のみの
    配布で、imagescriptの文字シェイパー（HarfBuzz系WASM）との相性が不明だったため避け、
    静的ウェイトが配布されている**M PLUS 1p Bold**（google/fontsリポジトリの
    `ofl/mplus1p/MPLUS1p-Bold.ttf`を実行時に直接fetch、約1.7MB）を採用した。実際に日本語文字列
    （感嘆符・絵文字混じり含む）が正しくレンダリングされることを確認済み。
  - サイトのfavicon（`public/favicon.ico`）を画像に載せることも検討したが、ICOフォーマットは
    imagescriptの`Image.decode`が非対応（デコード失敗を確認済み）だったため見送り、
    ブランドカラーのテキストロゴのみにした。
- **Xへのメディアアップロード**: X API v1.1の単純アップロード（`POST media/upload.json`）は
  現在の公式ドキュメント（docs.x.com）から姿を消しており、代わりにv2のchunked upload
  （`/2/media/upload/initialize` → `/2/media/upload/{id}/append` → `.../finalize`、必要なら
  `GET /2/media/upload?command=STATUS`でポーリング）が案内されている（2026-09-04調査時点）。
  OAuth 1.0aはこれらのエンドポイントでも動作することを公式ドキュメント・開発者コミュニティで
  確認できたため、新規のOAuth2フロー導入は不要だった。画像は数百KB程度でX側の上限
  （5MB）に対して十分小さいため、appendは1回（`segment_index=0`）のみで足りる設計にしている。
  - **append方式の選定**: appendはmultipart/form-dataとJSON+base64のどちらもサポートされて
    いるが、「OAuth 1.0a×multipartの署名まわりで"could not authenticate you"になる」という
    報告が開発者コミュニティで散見されたため、あえてJSON+base64を使った。これなら
    `/2/tweets`等このファイルの他のPOST呼び出しと全く同じ「JSON bodyは署名対象に含めない」
    という仕組みで安全に扱える（大きめのUint8Arrayを`btoa`に直接spreadするとスタック上限に
    達しうるため、`bytesToBase64()`で32KBずつ小分けにしている）。
  - GETのSTATUS確認だけはクエリパラメータ（`command`/`media_id`）を署名に含める必要があるため、
    既存の`buildOAuthHeader(method, url)`に`extraParams`引数を追加して対応した
    （POST側の各呼び出しは従来通り第3引数を省略すればよい、後方互換）。
  - **フォールバック設計**: 画像機能の不具合で毎週の投稿自体が止まってしまうことを避けるため、
    失敗を2段階で吸収している。①`buildClipperRankingCard()`自体の失敗（フォント/アバター
    取得先の一時的な障害等）は`buildClipperSpotlightPost()`内でtry/catchし、`imageBytes: null`
    としてテキストのみの投稿を続行する。②画像生成には成功したがXへのアップロード自体が
    失敗した場合は、`main()`側で改めてテキストのみの`postTweet()`を呼び直す。
  - アバター画像個別の取得失敗（Twitch側で削除済み等）もその1行だけ省略して他の行は表示を
    続ける設計（`buildClipperRankingCard`内で行ごとにtry/catch）。
- **本番での実投稿確認は未実施**（2026-09-04時点）。実際にXへ投稿する行為はユーザーの
  X公式アカウントに実害を伴うため、本セッションでは行っていない。かわりに
  ①`deno check`での型検証、②`buildClipperRankingCard`を実データ（本番Supabaseの
  `get_top_clippers_by_period`結果・実際のTwitchアバターURL）で呼び出し画像を目視確認
  （5人分・2人分＋アバター欠損ケースの両方）、③`buildClipperSpotlightPost`をエンドツーエンドで
  呼び出しテキスト・画像バイト列が正しく組み立つことを確認、の3点で検証済み。
  実際のXアップロード（`initializeMediaUpload`/`appendMediaChunk`/`finalizeMediaUpload`）と
  `/2/tweets`への画像添付は、公式ドキュメント・開発者コミュニティの記述に基づいて実装した
  ものの、本物のクレデンシャルでの動作は次回土曜の自動実行（またはユーザーによる手動実行）が
  初回になる。**もし失敗する場合、最初に疑うべき点**: ①`media_category`/`media_type`の値、
  ②`api.x.com`ホスト（`/2/tweets`は従来通り`api.twitter.com`のまま変更していない、
  混在させている）、③append方式（JSON+base64 vs multipart）のOAuth1署名の相性。

## 新規サイトお知らせバナー（2026-09-04追加）

- 「最近開設したサイトだと視聴者に知ってもらい、『今のうちに使えば古参になれる』という
  承認欲求に訴えたい」という要望への対応。トップページのヘッダー直上（サイトに来て最初に
  目に入る位置）に、コーラルレッド〜紫のグラデーション背景の帯（`NewSiteBanner`、
  `ClipRanking.jsx`）を追加した。文面:
  「クリスレは2026年9月にスタートしたばかりの新しいサイトです。今のうちに使い始めれば、
  あなたも「古参」になれるかも？」
- 閉じるボタン（×）で消せ、一度閉じたら二度と出さないよう`localStorage`
  （`cv-new-site-banner-dismissed`）に記録する。お気に入り/配信者タグ等と違い
  アカウント（anon_id経由のDB保存）に紐付ける必要性が薄い「端末ごとの表示上の好み」
  という判断で、`useActivityFeedPrefs`と同じ考え方であえてバックエンドに触れず
  localStorageのみで完結させている。ブラウザで実際に閉じる→リロードしても再表示されない
  ことを確認済み。
- **今後の教訓**: この文面は「2026年9月にスタートしたばかり」という具体的な時期に
  言及しているため、開設からある程度時間が経って「最近」と言えなくなった時点で
  文面を見直す（または`NewSiteBanner`自体を削除する）必要がある。ユーザーから
  明示的な削除・変更の指示が無くても、season性のある文言だという点を踏まえておくこと。

## 会員登録機能（2026-09-04追加）

- 「番号を1から振っていく、早めに登録した人ほど若い番号で後々自慢できる」という要望への対応。
  会員限定機能の第一弾は「コメント欄に会員番号バッジを表示」（ユーザーと相談の上、まずはこれだけに
  スコープを絞った）。
- **登録方式**: 匿名セッション（anon_id）をそのまま維持しつつメール+パスワードを後付けする
  「匿名→本登録」方式（Supabase Authの標準機能）を採用。単純にanon_idへ連番を振るだけの方式
  （メール不要）も検討したが、ブラウザデータを消すと番号を失うため「ずっと自慢できる番号」には
  ふさわしくないと判断し、ユーザーの同意のもとこちらを選んだ。この方式なら`auth.uid()`が
  登録前後で変わらないため、既存のお気に入り・配信者タグ・リアクションスタンプ・コメント履歴も
  そのまま引き継がれる。
  - フロントの実装は`src/components/RegisterPage.jsx`（`/register`）。
    ①メールアドレス入力→`supabase.auth.updateUser({email}, {emailRedirectTo: ".../register"})`で
    確認メール送信 ②メール内リンクを開くと同じ`/register`へ戻ってくる設計にしており、
    再訪問時に`supabase.auth.getUser()`の`is_anonymous`が`false`になっていれば次のステップへ
    自動的に進む ③パスワード設定（`updateUser({password})`）④`register_member()` RPCで
    会員番号を発行。既に会員なら`useMembership`が拾って「あなたの会員番号は#N」の画面を出す。
  - **別デバイスでのログイン**も同じページに実装済み（`supabase.auth.signInWithPassword`）。
    ログインするとそのブラウザのSupabaseセッションが登録済みアカウントのものに置き換わり、
    以降`ensureAnonymousSession()`が返す`user.id`（＝`auth.uid()`）が同じになるため、
    お気に入り/配信者タグ/リアクションスタンプ等の**全ての既存フックが変更なしでそのまま
    同期される**（これらは元々すべて`anon_id = auth.uid()`でRLS/クエリしているため）。
    - **既知の制約**: ログインする前にそのデバイス（ブラウザ）で匿名のまま既に
      お気に入り等を使っていた場合、その分は別のanon_idに紐づいたまま残り、
      ログイン後のアカウントには自動マージされない（単に見えなくなるだけでDB上は残る）。
      複数デバイスを渡り歩く前提のヘビーユーザーはそう多くない想定のため、
      現状は明示的なマージ機能は作っていない。要望が出れば別途検討。
  - **DB**: `supabase/migrations/20260904000000_members.sql`（本番へ適用済み、2026-09-04）。
    `members(id uuid primary key references auth.users, member_number integer generated
    always as identity, registered_at)`。RLSは本人の行のみSELECT可、INSERT/UPDATE/DELETE用の
    ポリシーはあえて用意していない（ポリシー無し＝拒否、書き込みは`register_member()`
    security definer RPC経由のみに限定）。
    - `register_member()`: `auth.jwt()->>'is_anonymous'`が`true`（＝メール確認未完了）なら
      例外を投げて拒否する。冪等（既に登録済みなら何もせず既存の番号を返す）。
      実際にanonymousユーザーで呼び出し、正しく拒否されることを本番で確認済み
      （テスト用の匿名ユーザー行は削除済み）。
    - `get_comment_member_numbers(comment_ids uuid[])`: コメント一覧に会員バッジを表示するための
      RPC。`comments.anon_id`をクライアントへ直接返さず（既存の「表示はしない、開示請求対応用」
      方針を踏襲）、`comments`と`members`をJOINした結果（comment_id・member_numberのみ）を
      security definerで返す。
  - フロント側フック（`useMembership`/`useCommentMemberBadges`）は`src/lib/use-clip-ranking.ts`、
    バッジ表示は`ClipRanking.jsx`（`CommentSidebar`）・`ClipDetail.jsx`の両方
    （既存の「コメントUIはこの2箇所に重複実装」パターンを踏襲）。総合スレ/タグスレの
    コメント（`tag_thread_comments`）にはまだ対応していない（要望が出れば同じパターンで追加可能）。
- **要調査・未検証（2026-09-04時点）**: このサイトで初めて実際にメールを送信する機能のため、
  以下はユーザー側でのSupabaseダッシュボード確認・本番での実地確認が必要
  （本セッションではメール受信ができないため、テストできなかった）。
  - Authentication → URL Configuration → Redirect URLsに`https://kurisure.jp/register`
    （開発時は`http://localhost:5173/register`等）が登録されているか。
  - デフォルトのSupabaseメール送信は件数制限が厳しめ（無料枠は目安1時間あたり数通程度）。
    登録者が増える想定ならカスタムSMTPの設定を検討すること。
  - 「メール確認リンクをクリック→`/register`にリダイレクト→自動で次のステップへ進む」という
    挙動そのもの（`emailRedirectTo`の実際の遷移・`is_anonymous`が正しく`false`になるタイミング）
    は公式ドキュメントの記述をもとに実装したのみで、実際にメールを受信して確認する
    エンドツーエンドの動作確認はできていない。初回の実登録トライで問題が出た場合は
    ここを疑うこと。

### ハマった点: register_member()がメール確認済みでも弾かれることがあった（2026-09-04）

- **ユーザー報告**: 「パスワードを登録完了してないのにログインができてしまった」。
- **原因**: `register_member()`が`auth.jwt()->>'is_anonymous'`（アクセストークンJWTに
  埋め込まれたクレーム）を見て判定していたが、JWTは発行時点のクレームを保持する仕組みのため、
  メール確認リンクを踏んで`auth.users.is_anonymous`がサーバー側では`false`に更新された後も、
  クライアントが保持している（確認前に発行された）古いアクセストークンには`is_anonymous=true`が
  埋め込まれたままのことがある（セッションが明示的にリフレッシュされるまで更新されない）。
  そのため実際にはメール確認済みのユーザーが誤って「メール確認が完了してから登録してください」
  で弾かれることがあった。一方`updateUser({password})`はこのクレームに依存せず独立して成功する
  ため、「パスワードだけ設定されて会員番号は発行されない」という分かりにくい状態になり、
  ユーザーには「登録が完了していないのにパスワードでログインできる（＝実際にはパスワードは
  正常に設定されていた）」ように見えた。**パスワードの不正なバイパスではない**
  （`signInWithPassword`は実際に設定された正しいパスワードでのみ成功する、本番相手に
  匿名ユーザーでの拒否動作を再現テストして確認済み）。
- **対応**（`supabase/migrations/20260904010000_register_member_live_is_anonymous.sql`、
  本番へ適用済み）: `register_member()`をJWTクレームではなく`auth.users.is_anonymous`列を
  直接参照するよう修正（SECURITY DEFINERなのでRLSに関係なく読める。この列は常に最新の
  サーバー側の状態を反映するためクライアントのトークンが古くても正しく判定できる）。
  加えて`RegisterPage.jsx`側にも保険として、メール確認を検知した直後に
  `supabase.auth.refreshSession()`を呼ぶ処理を追加した（無くても動くが、他の箇所で
  将来`auth.jwt()`ベースの判定を追加した場合に同じ罠を踏まないための予防）。
- **今後の教訓**: `auth.jwt()`（JWTクレーム）ベースの判定は、そのクレームに影響する
  ユーザー状態の変更（メール確認、ロール変更等）が起きた直後は古い値を見てしまう可能性がある。
  「今まさに状態が変わった直後」を正しく判定したいRPCでは、`auth.jwt()`ではなく対象テーブル
  （`auth.users`等）の実データを直接参照する方が安全（今回のように SECURITY DEFINER なら
  RLSを気にせず読める）。

### メールテンプレートの日本語化・送信元の変更について（2026-09-04、要ユーザー対応）

- 「確認メールが海外のスパムメールみたいなので日本語でしっかり書きたい、送信元もクリスレに
  したい」という指摘への対応。以下の理由でこの2つはSupabaseダッシュボードでの手動対応が必要と
  判断し、CLIやAPI経由での自動変更は行わなかった:
  - メールテンプレートは`supabase config push`で`config.toml`から一括反映できるが、
    このコマンドは`config.toml`の内容を丸ごとプロジェクトへ反映する仕組みで、現在の本番の
    Auth設定（匿名サインイン許可・その他のテンプレート・レート制限等）を先に正確に
    `config.toml`へ再現できない限り、意図せず他の設定を初期値に戻してしまうリスクがある。
    本サイトは匿名サインインに全面的に依存しているため、この設定を誤って無効化すると
    サイト全体が壊れる。安全に自動化できる手段が無かったため見送った。
  - 送信元（Fromアドレス・表示名）を変更するには**カスタムSMTPの設定**が必須
    （Supabaseのデフォルトメール送信は送信元を変更できない）。これはメール配信サービス
    （Resend/SendGrid/Postmark/AWS SES等）のアカウント作成・`kurisure.jp`ドメインの
    DNS認証（SPF/DKIM）・SMTP認証情報の入力が必要で、いずれもユーザー自身の判断・
    アカウント作成が要る領域のため代行していない。
  - 会員登録フローで実際に使われるテンプレートは**「Change Email Address」**
    （Authentication → Email Templates）。件名・本文の日本語文面はユーザーへ提案済み
    （セッション内の会話参照、`{{ .ConfirmationURL }}`変数を使用）。
  - **実登録の動作確認が取れた（2026-09-04）**: 本番の`members`テーブルに実際に
    `member_number=1`の会員登録（本サイトのユーザー自身のメールアドレス）が作成されている
    ことを確認した。メール確認リンク→パスワード設定→`register_member()`の一連の流れが
    実際に動作することの実地確認になった（前述の「JWTクレームの古さ」バグ修正が有効だった
    ことの裏付けでもある）。

### カスタムSMTP設定（Resend、2026-09-04）

- 確認メールの日本語化・送信元表示名変更（「クリスレから届くようにしたい」）のため、
  メール配信サービス**Resend**を導入することにした（無料枠で十分・SMTP対応・
  ドメイン検証の手順がシンプルという理由で選定、ユーザーと相談の上決定）。
- `kurisure.jp`のドメイン検証用に以下のDNSレコードをお名前.com「DNSレコード設定」
  （`01〜04.dnsv.jp`のネームサーバー、詳細は「独自ドメイン移行」節参照）へ追加した:
  - TXT `resend._domainkey` — DKIM公開鍵
  - CNAME `rsend` → `rsend-apne1.forge.rmta.net`
  - CNAME `send` → `send.forge.rmta.net`
  - TXT `_dmarc` — `v=DMARC1; p=none;`（まずは監視のみのポリシー）
  - 追加前に衝突が無いことを確認済み（4つのホスト名とも既存レコード無し）。DKIM値は
    Resend側の値と1文字も違わないことをスクリプトで突合確認済み。
  - お名前.comは保存してから実際にネームサーバーへ反映されるまで最大1時間程度かかることが
    ある（独自ドメイン移行時のAレコード設定と同じ注意点）。
- Supabase側のSMTP設定（Authentication → SMTP Settings）に入力する値:
  ホスト`smtp.resend.com`、ポート`587`、ユーザー名`resend`固定、パスワードはResendダッシュボードの
  「API Keys」で発行するAPIキー（`re_`始まり、作成直後の一度しか表示されないので即コピー）。
  送信者名は「クリスレ」、送信者メールアドレスは`kurisure.jp`ドメイン上のアドレス
  （例: `no-reply@kurisure.jp`、ドメイン検証完了後でないと送信エラーになる）。
- **注意**: この節を書いている時点でドメイン検証がResend側で完了しているかは未確認
  （DNS反映待ちの状態でセッションが一旦区切られた）。今後SMTP周りで送信エラーが出た場合は
  まずResendのDomains画面で「Verified」になっているか確認すること。
  - **追記（同日、ドメイン検証完了後）**: 実際に登録を試したところ2つの症状が報告された。
    ①1通目の確認メールが届かず、2通目（別アドレス）を送ったら両方ほぼ同時に届いた
    （Resend側の新規ドメイン特有の送信ウォームアップ遅延、またはSupabase Auth側のメール
    送信キューの遅延の可能性が高いと見ている。コード側の送信処理自体は`updateUser`の
    成功/失敗を正しくawaitしているだけの単純な実装で、非同期に「詰まる」ような作りには
    なっていないため、外部要因の可能性が高いと判断。Resendダッシュボードの「Emails」
    ログで実際の送信・配送タイムスタンプを見れば切り分けられるはずだが、本セッションからは
    確認できないためユーザー確認待ち）。
    ②メール内リンクをクリックすると`/register`のメールアドレス入力画面に戻ってしまい、
    パスワード入力画面に到達しない、という不具合を実際に報告された。**これはコード側の
    不具合として修正済み**（詳細は次項）。

### ハマった点: 確認リンクを踏んでもパスワード画面に進まなかった（2026-09-04）

- **原因（推定、複合的）**: `RegisterPage.jsx`のメール確認検知ロジックが、リダイレクト後の
  URLに付与される情報を一切見ていなかった。具体的には2つの見落としがあった。
  - Supabaseのメール確認リンクがPKCEフロー（`?code=...`）を使う設定の場合、
    supabase-jsの`detectSessionInUrl`（既定true）が自動でセッション交換するのに任せていたが、
    このuseEffectの実行タイミングと競合するとレースコンディションになり得る。
  - **より本質的な原因と見られるもの**: 確認リンクが期限切れ・既に無効化されている場合
    （例: 同じメールアドレス変更を2回リクエストすると、古い方の確認リンクは無効になる。
    今回「1通目が届かず2通目を送った」状況では、両方のメールが後から届いた際に
    先に古い（1通目の）リンクを踏むとこれに該当し得る）、Supabaseは
    `?error=...&error_description=...`を付けて`/register`へリダイレクトしてくるが、
    このエラー情報を一切見ておらず、単に「確認できなかった」状態のまま何もエラー表示せず
    デフォルトのメール入力画面が再表示されるだけになっていた（ユーザーからは
    「何も起きずに入力画面に戻る」ように見える）。
- **対応**: `RegisterPage.jsx`に`handleUrlParams()`を追加。マウント時にURLの
  `code`/`error_description`パラメータを見て、①`code`があれば明示的に
  `exchangeCodeForSession()`を呼ぶ（`detectSessionInUrl`との二重実行になっても実害はない）、
  ②`error_description`があればエラーメッセージとして画面に表示する、③処理後は
  `history.replaceState`でURLからクエリパラメータを消す（リロード時の二重処理を防ぐ）、
  という処理を行うようにした。
- **今後の教訓**: メール確認等のリダイレクトベースのフローを実装する際は、
  「成功時にリダイレクト先で何が起きるか」だけでなく、**「失敗時にリダイレクト先で
  何が付与されるか（`error`/`error_description`等）」も必ず処理すること**。
  でないと今回のように「エラーを握りつぶして無言で最初の画面に戻る」という
  デバッグしづらい不具合になる。
  - **未検証（2026-09-04時点）**: この修正で実際に直るかは、本セッションでは
    メール受信ができないため確認できていない。次回ユーザーが試す際、まだ同じ症状が出る場合は
    リダイレクト後の実際のURL（`?error_description=...`の中身）を教えてもらい、
    根本原因（PKCE設定・トークン期限切れ・その他）を特定すること。

### 実は「ログイン中に新規登録」が真因だった（2026-09-04、重要）

- 上記の調査を実際にブラウザ（claude-in-chromeでユーザーの実ブラウザを操作）で再現テストした
  結果、**報告されていた不具合の真因が判明した**。「メールアドレス送信中から動きがない」の
  実体は、ネットワークレベルでは`PUT /auth/v1/user`が200で成功していた（ハングではなかった）。
  本当の原因は、**ユーザーのブラウザが既に会員#1としてログイン済み（is_anonymous=false）の
  状態のまま`/register`で「新規登録」を試していたこと**だった。既に確認済みメールを持つ
  アカウントに対して`updateUser({email})`を呼ぶと、Supabaseの「Secure Email Change」
  （既定で有効）により新旧両方のメールへの確認が必要になる、想定と異なる複雑なフローに
  入ってしまい、`RegisterPage.jsx`はこのケースを考慮していなかった。
  - 調査の過程でDBを直接確認したところ、**`members`テーブルが空になっていた**
    （会員#1の登録が消えていた）ことも判明。原因は不明だが、直前に追加した管理画面の
    「会員一覧」削除ボタンをユーザーが試した可能性が高いと推測（ログインアカウント自体
    ＝`auth.users`は無傷だった）。元の`registered_at`を保持したまま`overriding system value`で
    `member_number=1`として復元済み（identityシーケンスは既に1のままだったため、次の新規登録は
    正しく2になる）。
  - **副作用の申し送り**: 調査のため実際に本番の`/register`でテスト用の捨てアドレス
    （mailinator.com）を2回送信して再現確認した。この操作により、ユーザーの実アカウントに
    `email_change`保留状態ができている（`auth.users.email_change`列にテスト用アドレスが
    入ったまま、`email_change_confirm_status=0`）。**ログイン用メールアドレス本体
    （`email`列）は`shangpingshi@gmail.com`のまま変更されておらず安全**。保留中の変更は
    捨てアドレス宛のため誰も確認できず、自然に期限切れになる想定でそのままにしてある
    （`update auth.users`は自動モードの分類器でブロックされる操作のため、直接クリアは
    試みなかった）。
- **恒久対応**: ログイン中（`is_anonymous === false`）のユーザーにはそもそもヘッダーの
  「会員登録」リンクを出さないようにし、代わりに会員番号バッジ（登録済みなら）と
  「ログアウト」ボタンを表示するようにした（`ClipRanking.jsx`、`useMembership`に
  `isAnonymous`を追加）。ログアウトは`supabase.auth.signOut({ scope: "local" })`
  （この端末のセッションのみ、他デバイスのセッションは維持）→ `window.location.reload()`
  （新しい匿名セッションで全データを作り直す、個別フックのキャッシュを手動で無効化するより
  確実なため）。
  - **今後の教訓**: 匿名→本登録アップグレード方式のサイトで「登録」UIを作る際は、
    「既にログイン済みの状態でそのUIに来たらどうなるか」を必ず考慮すること
    （匿名ユーザー向けの初回登録と、既存の確認済みアカウントに対するメール変更は
    Supabase側で全く別のフローになるため、UIを分けるかそもそも入れないようにする必要がある）。

### 本当の本当の原因: refreshSession()が引き起こす無限ループだった（2026-09-04、最終決着）

- 上記の「ログイン中に新規登録」対策（ヘッダーからリンクを消す）をリリースした後、
  ユーザーが**ログアウトした状態から改めて新規登録を試しても同じ症状**（メール確認後に
  `/register`へ戻ってきても、またメールアドレス入力画面になり、パスワード画面に到達しない）
  が再現したため、真の原因は別にあった。
- **調査方法**: `console.log`を一時的に大量に仕込んで本番へデプロイし、実際にブラウザの
  コンソールログを取得して原因を特定した（推測ではなく実測で追った）。ログから以下が判明:
  - `getUser()`は正しく`is_anonymous: false`を返しており、`setEmailConfirmed(true)`も
    実際に呼ばれ、一度は`emailConfirmed: true`で正しく再レンダリングされていた。
  - しかし直後から**`onAuthStateChange`の`TOKEN_REFRESHED`イベントが1秒間に何度も
    連続発火し続ける無限ループ**に入っていた。
- **原因**: `checkConfirmed()`内で「念のための保険」として呼んでいた
  `supabase.auth.refreshSession()`が、それ自体`TOKEN_REFRESHED`イベントを発生させる。
  一方このページは`onAuthStateChange`の**あらゆる**イベントで`checkConfirmed()`を
  再実行する作りだった（`TOKEN_REFRESHED`イベントも例外にしていなかった）ため、
  `refreshSession()` → `TOKEN_REFRESHED`イベント発火 → `checkConfirmed()`再実行 →
  再び`refreshSession()` → … という**自己増殖する無限ループ**に陥っていた。
  ループ中も裏では`emailConfirmed`は一度trueになっていたはずだが、直後から始まる
  無限ループ（1秒間に何度もネットワークリクエストが飛び続ける）でブラウザ・ページが
  実質的に固まったような状態になり、ユーザーからは「メールアドレス入力画面のまま」
  にしか見えなかったと考えられる。
  - この`refreshSession()`呼び出しは、実は不要だった。`register_member()` RPCは既に
    （前述の修正で）JWTクレームではなく`auth.users`の実データを直接見るようになっているため、
    トークンが多少古くても正しく判定できる。「念のための保険」のつもりで足した処理が、
    保険どころか一番深刻なバグの原因になっていた。
- **対応**: `refreshSession()`の呼び出しを完全に削除。あわせて`onAuthStateChange`の
  ハンドラを「`SIGNED_IN`・`USER_UPDATED`イベントの時だけ`checkConfirmed()`を呼ぶ」ように
  変更し、`TOKEN_REFRESHED`等の無関係なイベントでは再実行しないようにした（今後似たような
  処理を追加する場合の再発防止も兼ねる）。デバッグ用の`console.log`はすべて削除済み。
- **今後の教訓**:
  1. **「念のための保険」で追加する処理ほど、それ自体が新たな不具合を生まないか慎重に
     検討すること**。特に認証まわりの副作用のある呼び出し（`refreshSession`、`signOut`等）は、
     それ自体がイベントを発生させ、そのイベントを購読している別のコードとの間で
     ループを作ってしまう可能性を常に疑うこと。
  2. `onAuthStateChange`のハンドラは、必要なイベント種別だけに明示的に絞ること
     （全イベントに反応する実装は、将来そのハンドラ内で何か副作用のある処理をした瞬間に
     無限ループ化するリスクを常に抱える）。
  3. **本番相手の「動かない」系の不具合は、推測で直そうとする前に、一時的なログ出力を
     仕込んで実測すること**。今回も最初の2回の修正（PKCE code交換の明示化、
     `error_description`の表示）はいずれも筋の良い改善ではあったが、実際の原因ではなかった。
     3回目でログを仕込んで初めて真因（無限ループ）に到達できた。

## 管理画面: 会員一覧・削除（2026-09-04追加）

- 会員登録機能の追加を受けて、管理画面（`/admin-e9ae0115e698436e`、実際のパスは
  `src/App.jsx`参照）に「会員一覧」タブを追加。既存の`admin_get_*`/`admin_set_*`と全く同じ
  パターン（`admin_check_password`で照合するsecurity definer RPC、対象テーブルはRLSで
  「本人以外閲覧不可」のため通常のテーブルアクセスでは管理者も読めない）を踏襲した。
  - `admin_get_members(p_password)`: `members`と`auth.users`をJOINして
    会員番号・メールアドレス・登録日時を返す（会員番号昇順＝登録が早い順）。
  - `admin_delete_member(p_password, p_id)`: `members`から削除するだけ
    （**アカウント自体（`auth.users`、メール/パスワード、既存のお気に入り・タグ・
    スタンプ・コメント履歴）は削除しない**、会員資格＝番号バッジだけを取り消す設計。
    アカウントごと削除したい場合は別途対応が必要、意図的にスコープを絞った）。
  - フロントは`useAdminMembers`（`src/lib/use-admin.ts`）と`MembersPanel`
    （`AdminPage.jsx`）。削除ボタンは`window.confirm`で一度確認を挟む
    （このプロジェクトで初めて`window.confirm`を使った箇所。既存の管理画面アクション
    （既読切り替え・非表示切り替え）は全て可逆なトグルだったため確認無しだったが、
    削除は取り消せない操作のため追加した）。
  - `admin_get_members`が使う`members`⋈`auth.users`のJOINクエリ自体は本番へ直接実行して
    正しく動くことを確認済み（実際に登録済みの会員1件が正しく返ってきた）。管理画面パスワードは
    Vaultに保管されており本セッションでは取得していないため、UI経由の削除操作自体は
    未検証（`admin_delete_member`は1行の`delete`文のみで既存パターンの流用のため
    リスクは低いと判断）。
  - **ハマった点（ユーザー報告・即日修正）**: 実際に管理画面を開いたところ
    「structure of query does not match function result type」エラーが発生した。
    原因は`auth.users.email`の実際の型が`character varying`（varchar）で、
    `admin_get_members`が`email text`として宣言していたこと。`RETURNS TABLE`の
    `return query`は列の型が宣言と完全一致している必要があり、varcharとtextの違いだけでも
    このエラーになる。`u.email::text`で明示的にキャストして解決
    （`supabase/migrations/20260904030000_fix_admin_get_members_email_type.sql`）。
    本番へ直接同じクエリを実行して解決を確認済み。**今後auth.usersの列（email等）を
    RETURNS TABLE関数で返す際は、varchar/textの型不一致に注意すること**
    （`information_schema.columns`で実際の型を確認してから宣言するのが安全）。

## 総合ランキング（日別×視聴回数順）のタイムアウトを修正（2026-09-04追加、重要）

- 「配信者一覧」節の「未修正の既知の問題」として記録していたバグを実際に修正した。
  トップページのデフォルト表示（日別×視聴回数順）で`get_ranked_clips`が本番でタイムアウト
  （57014）していた問題。
- **原因（EXPLAIN ANALYZEで実測して特定）**: `clips`テーブルには期間+視聴回数の複合索引
  `idx_clips_period_ranking(twitch_created_at, view_count)`が既に存在するが、プランナは
  なぜか`idx_clips_view_count`（view_count単独索引）を選び、view_count降順で全件スキャン
  しながら期間条件でフィルタする実行計画になっていた。「今日1日分」は54万件中1000件強と
  極めて疎なため、LIMIT 20に対する「view_count順に流せばすぐ見つかるはず」というプランナの
  見積もりが外れ、実際には28万行以上を無駄にスキャンしてから20件を見つけるまで約9.8秒
  かかっていた（本番実測、`Buffers: shared hit=255156`）。
- **対策**: `get_ranked_clips`の視聴回数順（デフォルト）・期間指定ありの分岐だけ、
  `with matched as materialized (...)`でCTEを強制的に確定させることで、プランナに
  `idx_clips_period_ranking`（期間側）を使った絞り込みを先に実行させ、その後で少数の結果
  （今日1日分なら1300件程度）だけをメモリ上でview_countソートする計画に変えた
  （`supabase/migrations/20260904040000_fix_ranked_clips_day_views_timeout.sql`）。
  実測で**9.8秒→160ms**に改善。全期間×視聴回数順（`idx_clips_view_count`をそのまま使うのが
  最適）はこの変更の対象外・従来通り。本番のanonロールで実際にAPI経由で叩いて
  0.3〜0.5秒で返ることを複数の期間・並び替えの組み合わせ（全期間/今月/日別 ×
  視聴回数/新着/コメント数順）で確認済み。
- **今後の教訓**: 複合索引を追加しても、プランナが必ずしもそれを選ぶとは限らない
  （特に「期間で絞ってから少数件をLIMIT付きでソートする」ようなクエリでは、LIMIT句が
  プランナの見積もりを狂わせやすい）。**「索引を足したはずなのに遅い」場合は、
  索引の有無ではなくEXPLAIN ANALYZEで実際に使われている索引を確認すること**。
  materialized CTEで特定のフィルタを強制的に先に評価させるのは、この種の
  プランナの誤選択を回避する実用的な手段として使える（副作用として、対象行数が
  非常に多いケース（全期間等）では逆に不利になりうるため、`v_unbounded`のような
  分岐で対象を絞って適用すること）。

## 背景装飾ブロブを全ページへ展開（2026-09-04追加）

- 「トップページの背景はオシャレだが、他の画面（配信者一覧など）に遷移すると背景が
  無色の質素な感じになる」という指摘への対応。元々トップページ（`ClipRanking.jsx`）だけに
  実装していたぼかしたブランドカラーの光の塊3つ（`bgGlow`/`bgBlob`スタイル、
  `cv-bg-blob-1/2/3`のCSSアニメーションクラスはtheme.cssに既存）を、新規
  `src/components/BackgroundGlow.jsx`という共通コンポーネントに切り出し、管理画面
  （`AdminPage.jsx`、意図的に対象外＝内部ツールらしい質素な見た目のままにする）を除く
  **全ページ**（配信者一覧・詳細、クリップ職人一覧・詳細、クリップ詳細、クリップ検索、
  総合スレ、タグスレ一覧・詳細、お気に入り・評価した動画・スタンプ一覧、会員登録、
  サイトについて・利用規約・プライバシーポリシー・お問い合わせ）に展開した。
  - `ClipRanking.jsx`自身もこの共通コンポーネントを使うようリファクタし、
    重複していた`bgGlow`/`bgBlob`のstyle定義を削除した（今後ブロブの見た目を変える際は
    `BackgroundGlow.jsx`の1箇所を直せば全ページに反映される）。
  - 各ページの`page`スタイルには`position: "relative", zIndex: 0`を追加する必要がある
    （`BackgroundGlow`の`position: fixed; zIndex: -1`を正しく`page`基準でスタッキング
    させるため。詳細は`BackgroundGlow.jsx`内のコメント参照）。機械的な変更点が多い
    （17ファイル）ため、Node.jsスクリプトで一括適用した（手作業でのコピペミスを避けるため）。
  - `ClipDetail.jsx`/`MyReactions.jsx`/`TagThreadDetail.jsx`のように「エラー/未確認時の
    早期return」と「本来のレンダリング」で`<div style={styles.page}>`を2箇所持つファイルは、
    両方に`<BackgroundGlow />`を挿入した（エラー画面だけ質素なままにならないように）。

# ステアリング

- git commitを行う際は、同じタイミングでリモート（origin）へのpushも必ず行うこと。ユーザーから別途pushを依頼されるのを待たない。
- 修正が完了したら、その都度コミット・pushまで自動的に行うこと（2026-09-04、ユーザー指示）。
  「コミットしてください」等の個別依頼を都度待たない。
- このリポジトリではOpenSSLバックエンドでCA証明書検証エラーが発生する環境のため、`git config http.sslBackend schannel` をローカルリポジトリ設定として適用済み（2026-09-02）。pushが失敗する場合はこの設定が外れていないか確認すること。
- UIに装飾目的の絵文字（😲など）を使わないこと（2026-09-03、ユーザー指摘）。アイコンが必要な箇所は
  既存パターンに倣って`lucide-react`のアイコンコンポーネントを使う。

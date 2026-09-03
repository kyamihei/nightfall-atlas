# ClipVote プロジェクト概要

サイト名「クリスレ」（`<title>`は「クリスレ | Twitchクリップの掲示板サイト」）。
Twitchクリップのランキング掲示板。お気に入り・独自リアクションスタンプ・匿名コメント（返信対応）・
クリップ検索（タイトル/URL）・総合スレ・トレンド表示・配信者検索・登録リクエストができるサイト
（tw-clip相当のUI/仕様を踏襲）。いいね/よくないね機能はバックエンドごと残したままUI上のみ無効化しており、
代わりに独自のリアクションスタンプ機能を主軸にしている（詳細は各節を参照）。

## 技術構成

- フロント: React 19 + Vite + react-router-dom。UIはstyleオブジェクトによるインラインCSS（外部CSSフレームワークなし）。`src/styles/theme.css`（`main.jsx`でグローバル読み込み）に全ページ共通の演出（フォント読み込み・スクロールバー・ボタン押下フィードバック・フォーカスリング・`cv-`接頭辞の共通アニメーションクラス）を集約している
- バックエンド: Supabase（Postgres + Auth匿名サインイン + Edge Functions + Realtime）
- クリップ同期: `sync-twitch-clips.ts`（Deno）がTwitch Helix APIから定期的にクリップを取得し、Supabaseへ書き込む。`sync-live-clips.ts`はいまライブ中の配信者だけを高頻度でチェックする軽量版（詳細は後述）。`refresh-clip-views.ts`は既存クリップのview_countだけを定期的に再取得する別スクリプト（詳細は後述）
- 自動実行: `.github/workflows/sync-clips.yml`が毎朝JST 6:05頃に新規クリップ収集（全追跡配信者対象）を実行、`.github/workflows/sync-live-clips.yml`が15分おきにライブ中配信者だけの軽量同期を実行、`.github/workflows/refresh-clip-views.yml`が毎時20分にview_count同期を実行（すべて`workflow_dispatch`で手動実行可）

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
  - `Footer.jsx` - 全ページ共通フッター（ホーム/サイトについて/利用規約/プライバシーポリシー/お問い合わせ＋Copyright）
  - `AboutPage.jsx` / `TermsPage.jsx` / `PrivacyPage.jsx` - 静的コンテンツページ（`/about`, `/terms`, `/privacy`）
  - `ContactPage.jsx` - お問い合わせフォーム（`/contact`）
- `src/lib/supabase-client.ts` - Supabaseクライアント初期化＋匿名認証（`ensureAnonymousSession`）
- `src/lib/use-clip-ranking.ts` - データ層フック集（`useClips` / `useReactions` / `useFavorites` / `useMyFavorites` /
  `useClipStamps` / `useMyStamps` / `useTrendingClips` / `useClipSearch` / `useComments` /
  `useBroadcasterSearch` / `useBroadcasterRequest` / `useContactForm` / `useCommentReport` /
  `useBroadcasterAvatars` / `useClipperRanks` / `useTopClippersByPeriod` など）。`favorites`テーブル・RLSは
  Supabaseスキーマに元々あったがUIが未実装だったため2026-09-02に`useFavorites`/`useMyFavorites`と
  UIを追加して完成させた
- `supabase/schema.sql`, `supabase/migrations/` - テーブル・RLS・トリガー・RPC定義
- `supabase/functions/post-comment/` - コメント投稿Edge Function（NGワード検査・レート制限）
- `supabase/functions/request-broadcaster/` - 配信者登録リクエストEdge Function（Twitch実在確認つき）
- `supabase/functions/submit-contact/` - お問い合わせフォーム送信Edge Function（レート制限のみ、NGワード検査なし）
- `sync-twitch-clips.ts` - Twitchクリップ同期バッチ（Deno、ルート直下）

## 期間・日付の仕様

- ランキング期間タブ: 全期間 / 今年 / 今月 / 日別
- 「1日」の区切りはtw-clipの仕様に合わせて朝6:00〜翌朝6:00（`getPeriodRange`, `src/lib/use-clip-ranking.ts`）

## 並び替え・コメント返信（2026-09-02追加）

- トップページに並び替えセレクター（視聴回数順 / 新着順 / いいね順 / コメント数順）を追加。
  `get_ranked_clips` RPC（`supabase/schema.sql`）が期間フィルタ・並び替え・ページネーションを一度に処理する。
  - **重要**: いいね順・コメント数順は「反応/コメントが1件も付いていないクリップ」をランキングに含めない
    （clips全件を毎回スキャンすると匿名ロールのstatement_timeout=3sを超えるため。詳細はRPC本体のコメント参照）
  - period_start/period_endは`null`ではなく`-infinity`/`infinity`をデフォルト値にしている。
    `(param is null or col >= param)`という書き方はPostgRESTの汎用実行計画で索引が効かなくなり
    タイムアウトする（本番で実測・修正済み）。同様のRPCを今後追加する際は同じ罠に注意すること。
  - `idx_clips_view_count`（view_count desc単索引）を追加済み。「全期間×視聴回数順」がこの索引を使う。
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

## ヘッダー固定表示・配信者への個人タグ付け（2026-09-03追加）

- トップページのヘッダー〜ライブ活動フィードまでを`position: sticky; top: 0`でまとめて固定表示に変更
  （`ClipRanking.jsx`の`styles.stickyHeader`、`<header>`と`<ActivityTicker>`を1つのdivで囲む）。
  - **ハマった点**: `page`要素に付けていた`overflow: hidden`（背景ブロブ演出のためのもの）が
    残っていると、sticky要素は「overflowがvisibleでない最も近い祖先」を基準にスティッキングして
    しまうため、`page`自身が非スクロールの巨大な高さを持つ結果スティッキングが機能しなくなる。
    背景ブロブのクリップは`bgGlow`自身の`overflow: hidden`だけで十分だったため、`page`側からは
    `overflow: hidden`を削除して解決。
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
  `public/robots.txt`・`public/sitemap.xml`も新規追加（sitemapは静的ページのみ）。
  - **未対応（次のステップ候補）**: クリップ/配信者/クリップ職人の個別ページ
    （`/clips/:id`等）はSPAのため`index.html`の固定`<title>`/metaしか出せておらず、
    sitemap.xmlにも含めていない。動的にmetaを差し替える対応（react-helmet-async等）と、
    ビルド時にSupabaseから全クリップ/配信者IDを取得してsitemapへ含める仕組みは、
    より大きな作業になるため今回は見送った。

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
- GitHub Actions Secrets: `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TARGET_GAME_IDS`
- 元のセットアップ手順・秘密値は親ディレクトリ（`C:\clip-vote`）の `CLAUDE_CODE_INSTRUCTIONS.md` と `.env.human-provided` を参照（このリポジトリには含まれない）

# ステアリング

- git commitを行う際は、同じタイミングでリモート（origin）へのpushも必ず行うこと。ユーザーから別途pushを依頼されるのを待たない。
- このリポジトリではOpenSSLバックエンドでCA証明書検証エラーが発生する環境のため、`git config http.sslBackend schannel` をローカルリポジトリ設定として適用済み（2026-09-02）。pushが失敗する場合はこの設定が外れていないか確認すること。
- UIに装飾目的の絵文字（😲など）を使わないこと（2026-09-03、ユーザー指摘）。アイコンが必要な箇所は
  既存パターンに倣って`lucide-react`のアイコンコンポーネントを使う。

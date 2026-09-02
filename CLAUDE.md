# ClipVote プロジェクト概要

Twitchクリップのランキング掲示板。いいね/よくないねの反応、お気に入り、匿名コメント、
配信者検索・登録リクエストができるサイト（tw-clip相当のUI/仕様を踏襲）。

## 技術構成

- フロント: React 19 + Vite + react-router-dom。UIはstyleオブジェクトによるインラインCSS（外部CSSフレームワークなし）。`src/styles/theme.css`（`main.jsx`でグローバル読み込み）に全ページ共通の演出（フォント読み込み・スクロールバー・ボタン押下フィードバック・フォーカスリング・`cv-`接頭辞の共通アニメーションクラス）を集約している
- バックエンド: Supabase（Postgres + Auth匿名サインイン + Edge Functions + Realtime）
- クリップ同期: `sync-twitch-clips.ts`（Deno）がTwitch Helix APIから定期的にクリップを取得し、Supabaseへ書き込む。`refresh-clip-views.ts`は既存クリップのview_countだけを定期的に再取得する別スクリプト（詳細は後述）
- 自動実行: `.github/workflows/sync-clips.yml`が毎朝JST 6:05頃に新規クリップ収集を実行、`.github/workflows/refresh-clip-views.yml`が毎時20分にview_count同期を実行（どちらも`workflow_dispatch`で手動実行可）

## ディレクトリ構成

- `src/components/` - 画面コンポーネント
  - `ClipRanking.jsx` - トップページ。ランキング一覧＋コメントサイドパネル（`/`）
  - `ClipDetail.jsx` - クリップ個別ページ、コメント欄はページ内常時表示（`/clips/:id`）
  - `BroadcasterList.jsx` / `BroadcasterDetail.jsx` - 配信者一覧・詳細（`/broadcasters`, `/broadcasters/:name`）
  - `MyReactions.jsx` - 自分が評価したクリップ一覧（`/my-reactions`）
  - `MyFavorites.jsx` - 自分がお気に入り登録したクリップ一覧（`/favorites`）
  - `ClipperList.jsx` - クリップ職人（クリップを作った視聴者）ランキング（`/clippers`。コンポーネント名/ルートは内部的に"clipper"のまま、UI表示名のみ「クリップ職人」）
  - `ClipperDetail.jsx` - クリップ職人詳細。そのクリップ職人が作ったクリップの視聴回数ランキング（`/clippers/:creatorId`）。ヘッダーの合計視聴回数・クリップ数は`get_clipper_stats` RPC（全件対象・正確）から取得し、期間タブで絞り込む一覧側のlimitに引きずられて数値が過小表示されないようにしている
- `src/lib/supabase-client.ts` - Supabaseクライアント初期化＋匿名認証（`ensureAnonymousSession`）
- `src/lib/use-clip-ranking.ts` - データ層フック集（`useClips` / `useReactions` / `useFavorites` / `useMyFavorites` / `useComments` / `useBroadcasterSearch` / `useBroadcasterRequest` / `useCommentReport` / `useBroadcasterAvatars` など）。`favorites`テーブル・RLSはSupabaseスキーマに元々あったがUIが未実装だったため2026-09-02に`useFavorites`/`useMyFavorites`とUIを追加して完成させた
- `supabase/schema.sql`, `supabase/migrations/` - テーブル・RLS・トリガー・RPC定義
- `supabase/functions/post-comment/` - コメント投稿Edge Function（NGワード検査・レート制限）
- `supabase/functions/request-broadcaster/` - 配信者登録リクエストEdge Function（Twitch実在確認つき）
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

- **サイト名を「クリスレ」に変更**（`<title>`は「クリスレ | Twitchクリップの掲示板」）。トップページの
  サブタイトルも「みんなのお気に入りのクリップにコメントしてみよう！」に変更（`ClipRanking.jsx`）。
- **Twitch本家のクリップいいね（リアクション絵文字）は集計不可と判明**：Twitch Helix
  （公開API）のGet Clipsレスポンスにはリアクション/絵文字データが含まれておらず、視聴者が見ている
  「いいね」的な機能は非公開のGraphQL/クライアント側実装であり外部から取得する手段がない
  （Web調査で確認、2026-09-03）。この項目はユーザーへの説明のうえ実装を見送り、
  代わりに以下の独自リアクションスタンプで置き換えた。
- **リアクションスタンプ機能**: 「すっご」「うおｗ」「えっど」「こっわ」「うっま」「へった」「ひっど」の
  7種類のスタンプをクリップごとに複数選択可能（`clip_reaction_stamps`テーブル、
  `(clip_id, anon_id, stamp)`でunique）。`get_stamp_counts(clip_ids)` RPCで件数取得、
  `useClipStamps`フック（`use-clip-ranking.ts`）でトグル管理。`ClipRanking.jsx`のClipRow・
  `ClipDetail.jsx`の両方に絵文字ピッカーUIを実装。
  - 並び替えに「リアクション数順」を追加（`get_ranked_clips`のsort_by='reactions'、likes/favoritesと
    同じ「小さいテーブル起点でclipsへJOIN」パターンでタイムアウト回避）。
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

## 認証

- ログイン機能はなく、Supabase Anonymous Auth（匿名サインイン）でブラウザごとにanon_idを発行・永続化し、いいね/よくないね/お気に入り/コメントを紐付けている

## ローカル開発時の既知の制約

- `post-comment` Edge FunctionのCORS許可オリジン（`ALLOWED_ORIGIN`シークレット）が本番ドメイン
  （`https://clip-vote.vercel.app`）に固定されているため、`npm run dev`（localhost）からのコメント投稿は
  ブラウザのCORSでブロックされる（2026-09-02時点で確認済み、私の変更が原因ではない）。
  Edge Function自体の動作確認はcurl（CORSの影響を受けない）で行うこと。

## 環境変数

- `.env`（Git管理外）: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- GitHub Actions Secrets: `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TARGET_GAME_IDS`
- 元のセットアップ手順・秘密値は親ディレクトリ（`C:\clip-vote`）の `CLAUDE_CODE_INSTRUCTIONS.md` と `.env.human-provided` を参照（このリポジトリには含まれない）

# ステアリング

- git commitを行う際は、同じタイミングでリモート（origin）へのpushも必ず行うこと。ユーザーから別途pushを依頼されるのを待たない。
- このリポジトリではOpenSSLバックエンドでCA証明書検証エラーが発生する環境のため、`git config http.sslBackend schannel` をローカルリポジトリ設定として適用済み（2026-09-02）。pushが失敗する場合はこの設定が外れていないか確認すること。

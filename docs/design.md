# ComfyUI Batch Studio 設計書

## 1. 目的

ComfyUI での大量画像生成について、作品プロジェクトの作成からモデル選定、ワークフロー準備、実モデルの R2 管理、生成実行前の確認までを一つのデスクトップアプリで支援する。

文章・プロンプトツリー・ComfyUI ワークフローの生成とレビューは **Grok Web（grok.com）をユーザーが直接操作する**。xAI API は使用しない。

この文書は設計のみを扱う。既存の `Project` 配下、`D:\Tools\ComfyUI\scripts\civitai`、`D:\Tools\R2 File Manager` の実装は変更対象外とする。

## 2. 前提と制約

### 2.1 Grok Web 連携

- Grok Web は通常の Web ページの `iframe` として埋め込めない。したがってブラウザだけで完結するアプリにはしない。
- アプリは Electron のデスクトップシェルとし、ローカル操作画面と Grok Web を同じネイティブウィンドウに左右並びで表示する。
- 右ペインは Electron の `WebContentsView` で `https://grok.com/` を表示する。`iframe`、Webスクレイピング、Grok画面のDOM操作、ログイン自動化は行わない。
- ユーザーは右ペインで自分の Grok アカウントにログインし、送信・添付・会話継続を自ら実行する。
- Grok セッションはアプリ専用の永続ブラウザプロファイルにのみ保存する。アプリのプロジェクトデータ、ログ、R2、Civitaiカタログへ認証情報を保存しない。

### 2.2 成果物の正本

各プロジェクトの確定成果物はファイルシステム上の以下のファイルである。Grok会話は下書きを作る手段であり、正本ではない。

```text
{project_root}/
├─ story.md
├─ prompt_tree.md
├─ models.json
└─ LoRA_{project_name}.json
```

既存フォルダではワークフロー名に `LoRA Character Batch - ...json` などの旧命名もある。読み込み時は旧名称も検出するが、新規確定時の標準名称は `LoRA_{project_name}.json` とする。

### 2.3 既存データの観測結果

| 領域 | 現在の正本／実装 | Batch Studio での扱い |
| --- | --- | --- |
| 作品データ | `D:\Tools\ComfyUI\Project\{番号}_{名前}` | 読み込み・新規作成・確定ファイル保存 |
| ストーリー雛形 | `formts\stories-template.md` 等 | story 用のGrokプロンプトを組み立てる入力 |
| プロンプトツリー雛形 | `prompt_tree生成プロンプト.md` | tree 用のGrokプロンプト規則 |
| ワークフロー雛形 | `workflows\LoRA Character Batch.json` | workflow 用Grokプロンプトの添付対象／検証対象 |
| Civitaiカタログ | `scripts\civitai\data\model_catalog.json` | 検索・選択の候補データ |
| R2管理 | `D:\Tools\R2 File Manager` | 実体ファイルの所在・同期操作を委譲する対象 |

## 3. 全体アーキテクチャ

```text
┌──────────────────────────────── ComfyUI Batch Studio ────────────────────────────────┐
│ Electron main process                                                                  │
│  ├─ Project service: Project 配下の読取・確定保存・履歴                               │
│  ├─ Artifact validation: Markdown / models.json / workflow JSON の検査                 │
│  ├─ Civitai adapter: model_catalog.json の読取                                         │
│  ├─ R2 adapter: R2 File Manager との安全な連携窓口（後続）                             │
│  └─ Clipboard / file-reveal: Grok に渡すプロンプトと添付対象を準備                     │
│                                                                                         │
│  ┌───────────────────────┐  ┌──────────────────────────────────────────────────────┐ │
│  │ 左: ローカル操作画面  │  │ 右: Grok Web ネイティブペイン                         │ │
│  │ Project / モデル /    │  │ https://grok.com/                                    │ │
│  │ プロンプト / 検証     │  │ ログイン、会話、ファイル添付、送信はユーザーが操作    │ │
│  └───────────────────────┘  └──────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────────┘
             │                                               │
             ▼                                               ▼
    Project の確定成果物                         Grok Web の会話・添付
             │
             ├──────────────► Civitai model_catalog.json
             └──────────────► R2 File Manager / R2 の実体モデル
```

### 3.1 Electron を採用する理由

Electron の `WebContentsView` は外部Webコンテンツをネイティブ子ビューとして表示できる。ローカル画面の DOM に Grok Web を混在させないため、同一オリジン制約・iframe制限・認証情報の混在を避けられる。

ローカル画面は `contextIsolation: true`、`nodeIntegration: false` とし、必要最小限の IPC だけを preload で公開する。Grok ペインには preload、Node.js 権限、ローカルファイル権限を一切与えない。

## 4. 画面設計

### 4.1 主画面

初期状態は左右 45:55 の分割表示とする。境界はドラッグで変更でき、左画面を一時的に最大化して成果物を確認できる。

左画面には次を置く。

1. **プロジェクト一覧**: 既存プロジェクトの成果物充足状況を `story / tree / models / workflow` で表示する。
2. **工程ナビゲーション**: `概要`、`Story`、`Models`、`Prompt Tree`、`Workflow`、`R2`、`検証`。
3. **Grok作業カード**: 現工程で必要な文脈、生成用プロンプト、添付すべきファイル、操作手順を表示する。
4. **成果物エディタ**: Grokの応答を貼り付け、差分確認、検証、確定保存を行う。
5. **状態表示**: 下書き／検証エラー／確定、入力元ファイルの更新有無を表示する。

右画面には Grok Web のみを表示する。アプリは入力欄を操作せず、左画面の「プロンプトをコピー」ボタンでクリップボードへ準備する。ユーザーが右画面へ貼り付ける。

### 4.2 工程別Grok作業カード

| 工程 | 自動で組み立てる文脈 | ユーザーが Grok に添付するもの | 確定するファイル |
| --- | --- | --- | --- |
| Story | story作成規則、作品概要、テンプレート | 参考資料・任意の指示 | `story.md` |
| Models | Civitaiカタログの絞込結果、モデル選定規則 | 必要なら既存プロジェクトのモデル情報 | `models.json` |
| Prompt Tree | `story.md`、`models.json`、tree作成規則、候補モデル要約 | `story.md`、必要なら参考tree | `prompt_tree.md` |
| Workflow | `prompt_tree.md`、`models.json`、workflow作成規則、雛形の構造要約 | tree、models、雛形workflow | `LoRA_{project_name}.json` |

プロンプトには、出力先ファイル形式、編集可能な範囲、既存構造を変えてよいか、必要な場合だけ質問することを明示する。生成対象ファイルを丸ごと含めるのではなく、サイズが大きいワークフローは **添付するファイル** として案内し、プロンプト本文にはノード構造の要約のみを入れる。

### 4.3 Grokからの返答の確定操作

1. ユーザーが左ペインの生成プロンプトをコピーする。
2. ユーザーが右ペインの Grok Web に貼り付け、必要なファイルを添付し、会話を進める。
3. ユーザーが最終回答を左ペインの成果物エディタへ貼り付ける。
4. アプリが形式・参照整合性を検査する。
5. ユーザーが明示的に「確定保存」した場合だけ対象ファイルを更新する。

アプリは Grok の回答を自動取得も自動保存もしない。ユーザーが確認・貼り付け・確定することを必須とする。

## 5. データ設計

### 5.1 プロジェクトメタデータ

新規プロジェクトだけに `project_meta.json` を持たせる。既存プロジェクトでは、必要になるまで作らない。

```json
{
  "schemaVersion": 1,
  "projectId": "15_demon-slayer_kocho-shinobu",
  "displayName": "Kocho Shinobu",
  "createdAt": "2026-09-07T00:00:00Z",
  "artifacts": {
    "story": { "path": "story.md", "status": "draft" },
    "models": { "path": "models.json", "status": "missing" },
    "promptTree": { "path": "prompt_tree.md", "status": "missing" },
    "workflow": { "path": "LoRA_15_demon-slayer_kocho-shinobu.json", "status": "missing" }
  }
}
```

メタデータには Grok のCookie、会話本文、認証情報、R2シークレットを保持しない。会話URLを任意のメモとして保存する機能は将来追加できるが、既定では保存しない。

### 5.2 下書きと履歴

確定前の入力は `._batch_studio/drafts/{artifact}/{timestamp}`、確定直前のバックアップは `._batch_studio/history/{artifact}/{timestamp}` に保存する。隠し作業ディレクトリはプロジェクト内に限定し、既存の最終成果物を無断で上書きしない。

## 6. モデル選定と実体管理

### 6.1 二段階のモデル選定

1. **カタログ選定**: `model_catalog.json` の Civitai コレクションから候補を絞り込む。モデル名、バージョン、トリガー、ファイル名、容量、URL、ベースモデルを表示する。
2. **プロジェクト固定**: 選択したモデル・ファイルを `models.json` として保存する。`prompt_tree.md` とワークフローは、ここで固定したファイル名だけを参照する。

`models.json` は既存の Civitai Selection API と互換の `generatedAt`、`files`、`collections` 形式を保つ。画面では `.safetensors` など生成に使う実モデルと、training data ZIP のような付随ファイルを区別して表示する。

### 6.2 R2連携の責務

R2 は実モデルの保管場所であり、作品データの正本ではない。R2工程では次を扱う。

- `models.json` の各実モデルについて、R2上の有無、サイズ、更新日時、ETagを照合する。
- 未配置モデルのアップロード／ダウンロードは、既存 R2 File Manager の安全な機能を再利用する。
- ローカル ComfyUI の `models` 配下にある実体と、R2と、`models.json` の3者の差分を表示する。
- 削除・上書き・移動は明示確認を必須とし、初期リリースでは閲覧・照合を優先する。

R2 File Manager のローカルAPIはプロセスごとの保護トークンを利用するため、最初の統合は「R2 File Managerを開く」「対象キーをクリップボードへ渡す」までに留める。認証・トークン共有を伴う直接API統合は設計を分離して後続フェーズにする。

## 7. 検証仕様

### 7.1 story.md

- UTF-8 Markdownとして読み書きできること。
- 空でない見出しと本文があること。
- ユーザーが設定した必須項目（対象キャラクター、成人設定など）を満たすかは警告として表示し、機械的な内容改変はしない。

### 7.2 models.json

- JSONとして構文が正しいこと。
- `files` が配列で、各要素に `name` を持つこと。
- 同一ファイル名の重複を警告すること。
- ワークフローが参照する LoRA 名との突合に使えること。

### 7.3 prompt_tree.md

- UTF-8 Markdownとして読み書きできること。
- 必要モデル一覧を含むかを警告すること。
- `models.json` にない `.safetensors` 名が現れた場合、未確定候補として警告すること。文章内の単なる参考例は自動修正しない。

### 7.4 ワークフローJSON

- ComfyUIワークフローとして JSON 構文が正しいこと。
- `nodes`、`links`、`groups` が存在すること。
- `AnimaLoraStack` の有効LoRA名を取り出し、`models.json` のファイル名との不一致を表示すること。
- `SceneMatrix` の各行で `filename_enabled: true` を確認すること。
- 雛形で未使用とされた枝が bypass か空のLoRA／Matrixになっているかを警告すること。

検証は警告中心とする。Grokが生成した内容や、ユーザーが編集したJSONをアプリが自動修復することはしない。

## 8. セキュリティとプライバシー

- Grokの右ペインはローカル画面と別の `WebContents`、別セッションで実行する。
- Grok ペインは Node integration 無効、preloadなし、外部WebからのIPCなしとする。
- 外部URLへの遷移・別ウィンドウ要求は、許可リストまたは既定ブラウザへ引き渡す。Grokのログインに必要な正規の認証先だけは右ペイン内の遷移を許可する。
- Civitai APIキーとR2のシークレットは既存ツールの保管方式を維持し、Batch Studioは読み取らない。
- 成果物をGrokへ添付する前に、対象の絶対パスとファイルサイズを明示表示する。秘密情報を含む可能性のある `.env`、資格情報、R2設定は添付候補から除外する。

## 9. 実装フェーズ（未着手）

### Phase 1: 読み取り専用デスクトップ殻

- Electronの左右ペイン、Grok Webログイン、永続セッション。
- 既存プロジェクト一覧と成果物充足状況。
- Grok用プロンプトの表示・コピー、対象フォルダをExplorerで開く。

### Phase 2: プロジェクトと成果物の確定

- 新規プロジェクト作成、下書き、エディタ、明示保存、履歴。
- story / prompt_tree / workflow の構文検証。

### Phase 3: Civitaiカタログと models.json

- カタログ検索、コレクション選択、プロジェクト用 `models.json` の確定。
- tree・workflowとの参照整合性表示。

### Phase 4: R2照合

- R2 File Managerを起動・対象モデルを引き渡す連携。
- 実モデルの所在差分の閲覧。
- 直接R2 API統合は、認証境界と競合回避を設計した後に限定的に追加する。

## 10. 受け入れ基準

1. ユーザーが一つのデスクトップウィンドウ内で、左側のプロジェクト画面と右側のログイン済み Grok Web を同時に使える。
2. 左側で工程を選ぶと、正しい入力ファイル・添付対象・Grok向けプロンプトが提示される。
3. アプリはGrokの会話、ログイン情報、入力欄を自動操作しない。
4. ユーザーが貼り付けた成果物だけが、検証を経て明示操作によりプロジェクトに保存される。
5. `models.json`、`prompt_tree.md`、ワークフロー間のモデル名の不整合を保存前に表示できる。
6. 既存プロジェクトを壊さずに読み込み、旧ワークフロー名も認識できる。

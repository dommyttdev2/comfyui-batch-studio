# Project Initialization / Story Brief

Status: Active

## 1. 方針

新規プロジェクト画面は、ユーザーに細かな Story 設計を入力させる画面にしない。

ユーザーは「誰を対象に、どのような読者向けの作品を作りたいか」と最低限の制約だけを入力する。人物詳細、舞台、章構成、衣装推移、カメラ設計等は Grok が提案し、ユーザーとの会話で `story.md` にまとめる。

初期入力は `project_brief.json` に保存する。

## 2. 初期画面で入力するもの

### 2.1 必須

1. プロジェクト名。
2. 版権キャラかどうか。
3. 版権キャラの場合のキャラクター名。
4. ターゲット読者の特徴。
5. 成人・合意の固定前提確認。

### 2.2 任意

- 出典作品・シリーズ。
- 大まかな要望。
- 出さないもの・避けたい方向性。

### 2.3 詳細設定

初期画面を肥大化させず、必要な場合だけ開く。

- プロジェクト ID。
- Story 文書形式。
- 目標画像枚数。
- 想定モデル系。
- 目標章数。
- 参考ファイル。

## 3. 項目仕様

### 3.1 プロジェクト名

| 項目 | 値 |
| --- | --- |
| UI | 1行 text |
| 保存キー | `project.title` |
| 必須 | Yes |
| 用途 | 表示名、Story title候補、project folder name元 |

プロジェクト ID は表示名から候補を自動生成し、重複しない連番等を付ける。ユーザー入力を必須にしない。

### 3.2 版権キャラ

| 項目 | 値 |
| --- | --- |
| UI | checkbox |
| 保存キー | `character.is_copyrighted` |
| 必須 | 状態確定 |
| 用途 | キャラクター名必須制御、Grok調査指示 |

初期画面では主対象1人を扱う。複数人物は Grok との Story 設計で追加可能とする。

### 3.3 キャラクター名

| 項目 | 値 |
| --- | --- |
| UI | 1行 text |
| 保存キー | `character.name` |
| 必須 | 版権キャラ時のみ |
| 用途 | Grok調査の原典 |

オリジナルキャラクターでは任意。

### 3.4 出典作品・シリーズ

| 項目 | 値 |
| --- | --- |
| UI | 1行 text |
| 保存キー | `character.source_work` |
| 必須 | No |
| 用途 | 同名キャラクター誤認の軽減 |

未入力でも開始できる。

### 3.5 ターゲット読者の特徴

| 項目 | 値 |
| --- | --- |
| UI | 複数行 text + 任意候補chip |
| 保存キー | `audience.traits` |
| 必須 | Yes |

年齢等の属性入力欄ではなく、作品に求める体験を記述する。

観点例:

- 好む関係性・主導権。
- 求める感情・雰囲気。
- 重視するキャラクターの魅力。
- 重視する視覚要素・カメラ距離。
- 避けたい方向性。

### 3.6 成人・合意の確認

| 項目 | 値 |
| --- | --- |
| UI | checkbox |
| 保存キー | `constraints.adult_and_consent_confirmed` |
| 必須 | Yes |

Story 全体の固定前提として扱う。

### 3.7 大まかな要望

| 項目 | 値 |
| --- | --- |
| UI | 複数行 text |
| 保存キー | `request.overview` |
| 必須 | No |

テーマ、関係性、場所、場面などを自由記述する。空欄なら Grok に複数案を提案させる。

### 3.8 出さないもの・避けたい方向性

| 項目 | 値 |
| --- | --- |
| UI | 複数行 text |
| 保存キー | `request.exclusions` |
| 必須 | No |

キャラクター、衣装、時期、場所、構図、トーン等の除外条件。

## 4. 初期画面では入力させないもの

以下は完成 Story に必要でも、初期入力には並べない。

- 外見 anchor / invariant / 初期衣装。
- 性格 / 口調 / 物語上の役割。
- 相手役 / 人物関係 / 主導権。
- 舞台一覧。
- 開始・終了状態。
- 状態遷移。
- 章 / scene 構成。
- camera / viewpoint 原則。
- 衣装推移。
- 詳細 Prompt 設計。
- 使用 model / LoRA。

これらは後続の Grok Story / Model Selection / Prompt Planning 工程へ責務を分ける。

## 5. Layout

```text
┌─ 新しいプロジェクト ───────────────────────────┐
│ プロジェクト名 *                                │
│ [___________________________________________]   │
│                                                 │
│ キャラクター                                    │
│ [ ] 版権キャラである *                          │
│ キャラクター名（版権の場合は必須）              │
│ [___________________________________________]   │
│ 出典作品・シリーズ（任意）                      │
│ [___________________________________________]   │
│                                                 │
│ ターゲット読者の特徴 *                          │
│ [                                           ]   │
│ [                                           ]   │
│                                                 │
│ 大まかな要望（任意）                            │
│ [                                           ]   │
│                                                 │
│ 出さないもの・避けたい方向性（任意）            │
│ [                                           ]   │
│                                                 │
│ [ ] 登場人物は成人で、成人向け内容は合意を前提  │
│                                                 │
│ [詳細設定 ▾]              [Grokで案を作る]      │
└─────────────────────────────────────────────────┘
```

`Grokで案を作る` は Grok へ送信しない。Brief を保存し、Grok 用依頼文を生成して Clipboard 操作へつなぐ。

## 6. project_brief.json

```json
{
  "schemaVersion": 1,
  "project": {
    "id": "15_example",
    "title": "Example project"
  },
  "character": {
    "is_copyrighted": true,
    "name": "Character Name",
    "source_work": "Source Work"
  },
  "audience": {
    "traits": "..."
  },
  "constraints": {
    "adult_and_consent_confirmed": true
  },
  "request": {
    "overview": "",
    "exclusions": ""
  },
  "story": {
    "format": "narrative_clip",
    "target_chapter_count": null
  },
  "generation": {
    "target_image_count": 500,
    "model_family": "Illustrious"
  },
  "grok": {
    "reference_files": []
  }
}
```

## 7. 初期画面 Validation

Blocking error:

- プロジェクト名が空。
- 版権キャラ状態が未確定。
- 版権キャラ ON かつキャラクター名が空。
- ターゲット読者の特徴が空。
- 成人・合意確認が未チェック。

その他の未指定項目はエラーにせず、Grok 用文脈で「未指定」と扱う。

## 8. Story への引き渡し

初回 Grok 依頼では完成 Story を一度で要求せず、まず調査・Story 案・不足確認を行う。

その後の具体的な Grok 契約は `../contracts/grok-contract.md` が正本である。

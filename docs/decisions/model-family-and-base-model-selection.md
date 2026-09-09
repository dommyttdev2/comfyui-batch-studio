# Model family / base model selection ownership

Status: Accepted
Date: 2026-09-09

## Decision

Checkpoint と Prompt dialect を決める Model Family はユーザーが選択する。Grok に基盤モデルの再選定を許可しない。

- `Illustrious`: ユーザーが Checkpoint を必須選択する。
- `Anima`: ユーザーが Checkpoint / Text Encoder / CLIP をすべて必須選択する。
- 各モデルは Batch Studio の Civitai Collection inventory から Model / Version / File を選択する。
- 選択UIへ渡す候補は role ごとに事前filterする。検索結果から対象外モデルを見た目だけ隠す方式にはしない。
- Role判定は Civitai catalog に保存した `modelType` を正本とし、ファイル名から推測する fallback を設けない。
- Checkpoint / TextEncoder / CLIP の Version に `baseModel` が存在する場合、選択した Model Family と一致する候補だけを表示・受理する。
- 基盤モデルを変更した場合は既存LoRA選定を破棄し、再選定する。

## Artifact contract

新規選定は `models.json` schemaVersion 2 を使う。schemaVersion 1 は既存Projectの読み取り互換として維持する。

```text
Illustrious:
  modelFamily
  checkpoint
  loras[]

Anima:
  modelFamily
  checkpoint
  textEncoder
  clip
  loras[]
```

Animaで `textEncoder` / `clip` が欠けた状態は blocking error とする。Illustriousにそれらを保存することも許可しない。

## Grok contract

Grok の Model工程は LoRA selection のみを担当する。返却ファイルは `model_loras.json` とし、`checkpoint` / `textEncoder` / `clip` / `modelFamily` を含む回答はBatch Studioが拒否する。Batch Studioがユーザー選択済み基盤モデルへ `loras[]` だけをmergeして `models.json` Draftを構築する。

## Prompt dialect

- Illustrious: 通常のDanbooruタグは underscore (`looking_at_viewer`)。
- Anima: 通常タグは space (`looking at viewer`)。
- `trainedWords` はModel Familyに関係なくcatalog文字列を完全一致で使用し、変換しない。

Model Familyは `project_brief.json` にも保存し、Prompt Plan依頼時に明示的なdialect ruleへ変換する。モデル名からdialectを推測しない。

## Workflow boundary

本決定はModel選定ArtifactとPrompt設計の責務を定義する。既存Workflow ManifestはCheckpoint / LoRAのroleを持つがText Encoder / CLIPのnode roleをまだ定義していないため、Anima用Workflowへ実際に配線する場合はManifest/Compiler契約を別途拡張する。未定義nodeへ推測で値を書き込まない。

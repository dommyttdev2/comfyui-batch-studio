# Model family / base model selection ownership

Status: Accepted
Date: 2026-09-09

## Decision

Checkpoint と Prompt dialect を決める Model Family はユーザーが選択する。Grok に基盤モデルの再選定を許可しない。

- `Illustrious`: ユーザーが Checkpoint を必須選択する。
- `Anima`: ユーザーが Checkpoint / Text Encoder / VAE をすべて必須選択する。
- Checkpoint は Batch Studio の Civitai Collection inventory から Model / Version / File を選択する。
- Anima の Text Encoder は ComfyUI インストール先の `models/text_encoders` から選択する。
- Anima の VAE は ComfyUI インストール先の `models/vae` から選択する。
- R2連携済み環境では `r2ModelPrefix` を models root とみなし、同じ `text_encoders/` / `vae/` を候補へ統合する。
- ローカルとR2で同じ相対ファイル名が存在する場合は1候補へ統合し、UIで `ローカル` / `R2` の両インジケーターを表示する。
- Checkpoint選択UIへ渡す候補はCivitaiのCheckpointだけに事前filterする。LoRA等を候補へ混在させない。
- Text Encoder / VAE はファイル名から用途を推測せず、参照ディレクトリそのものを用途境界とする。
- 基盤モデルを変更した場合は既存LoRA選定を破棄し、再選定する。

## Artifact contract

修正後の新規選定は `models.json` schemaVersion 4 を使う。schemaVersion 1 / 2 / 3 は既存Projectの読み取り互換として維持する。schemaVersion 3 は誤ってAnimaの必須コンポーネントをCLIPとしていた旧契約であり、新規保存には使用しない。

```text
Illustrious:
  modelFamily
  checkpoint           # Civitai identity
  loras[]              # Civitai identity

Anima:
  modelFamily
  checkpoint           # Civitai identity
  textEncoder.fileName # models/text_encoders からの相対パス
  vae.fileName         # models/vae からの相対パス
  loras[]              # Civitai identity
```

Text Encoder / VAE のArtifactにはCivitai Model/Version/File IDを捏造しない。保存する `fileName` は各用途ディレクトリからの相対パスであり、Local/R2どちらに存在するかは環境依存のためArtifactへ固定しない。配置確認時に現在のLocal/R2状態を再評価する。

Animaで `textEncoder` / `vae` が欠けた状態は blocking error とする。Illustriousにそれらを保存することも許可しない。schemaVersion 2 / 3 の既存Anima Projectは読み取り可能だが、新しい選定UIではText Encoder / VAEをLocal/R2から再選択してschemaVersion 4へ移行する。

## Grok contract

Grok の Model工程は LoRA selection のみを担当する。返却ファイルは `model_loras.json` とし、`checkpoint` / `textEncoder` / `clip` / `vae` / `modelFamily` を含む回答はBatch Studioが拒否する。Batch Studioがユーザー選択済み基盤モデルへ `loras[]` だけをmergeして `models.json` Draftを構築する。

## Prompt dialect

- Illustrious: 通常のDanbooruタグは underscore (`looking_at_viewer`)。
- Anima: 通常タグは space (`looking at viewer`)。
- `trainedWords` はModel Familyに関係なくcatalog文字列を完全一致で使用し、変換しない。

Model Familyは `project_brief.json` にも保存し、Prompt Plan依頼時に明示的なdialect ruleへ変換する。モデル名からdialectを推測しない。

## Placement lookup

schemaVersion 4 のText Encoder / VAEは選択時・実行前確認時ともに用途別ディレクトリを厳密に使用する。

```text
Local:
  <ComfyUI>/models/text_encoders/<fileName>
  <ComfyUI>/models/vae/<fileName>

R2:
  <r2ModelPrefix>/text_encoders/<fileName>
  <r2ModelPrefix>/vae/<fileName>
```

`r2ModelPrefix` が空の場合はR2 bucket直下の `text_encoders/` / `vae/` を使用する。ローカル実行ではローカル配置必須・R2任意、リモート実行ではR2配置必須・ローカル任意、という既存配置ポリシーを維持する。

## Workflow boundary

本決定はModel選定ArtifactとPrompt設計の責務を定義する。既存Workflow ManifestはCheckpoint / LoRAのroleを持つがText Encoder / VAEのnode roleをまだ定義していないため、Anima用Workflowへ実際に配線する場合はManifest/Compiler契約を別途拡張する。未定義nodeへ推測で値を書き込まない。

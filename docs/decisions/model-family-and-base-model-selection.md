# Model family / base model selection ownership

Status: Accepted
Date: 2026-09-09

## Decision

基盤モデルと Prompt dialect を決める Model Family はユーザーが選択する。Grok に基盤モデルの再選定を許可しない。

- `Illustrious`: ユーザーが Checkpoint を必須選択する。
- `Anima`: ユーザーが Diffusion Model / Text Encoder / VAE をすべて必須選択する。
- Illustrious Checkpoint と Anima Diffusion Model は Batch Studio の Civitai Collection inventory から Model / Version / File を選択する。
- Anima の Diffusion Model は ComfyUI の `models/diffusion_models` へ配置する。
- Anima の Text Encoder は ComfyUI インストール先の `models/text_encoders` から選択する。
- Anima の VAE は ComfyUI インストール先の `models/vae` から選択する。
- R2連携済み環境では `r2ModelPrefix` を models root とみなし、同じ `diffusion_models/` / `text_encoders/` / `vae/` を配置境界として使用する。
- Text Encoder / VAE はローカルとR2で同じ相対ファイル名が存在する場合は1候補へ統合し、UIで `ローカル` / `R2` の両インジケーターを表示する。
- Checkpoint / Diffusion Model 選択UIへ渡す候補は Civitai の Checkpoint model type に事前filterする。Anima側では選択したidentityを `diffusion_model.main` として保存する。
- Text Encoder / VAE はファイル名から用途を推測せず、参照ディレクトリそのものを用途境界とする。
- 基盤モデルを変更した場合は既存LoRA選定を破棄し、再選定する。

## Artifact contract

新規選定は `models.json` schemaVersion 5 を使う。schemaVersion 1 / 2 / 3 / 4 は既存Projectの読み取り互換として維持する。

```text
Illustrious:
  schemaVersion: 5
  modelFamily: illustrious
  checkpoint            # Civitai identity / checkpoint.main
  loras[]               # Civitai identity

Anima:
  schemaVersion: 5
  modelFamily: anima
  diffusionModel        # Civitai identity / diffusion_model.main
  textEncoder.fileName  # models/text_encoders からの相対パス
  vae.fileName          # models/vae からの相対パス
  loras[]               # Civitai identity
```

schemaVersion 4 は Anima の Text Encoder / VAE 分離までは導入済みだが、基盤モデル本体を `checkpoint` として扱っていた旧契約である。schemaVersion 4 の Anima Project は読み取り可能だが、基盤モデル編集時に `diffusionModel` へ移行し schemaVersion 5 として保存する。Illustrious の既存 schemaVersion 2〜4 は読み取り・Workflow生成互換を維持する。

Text Encoder / VAE のArtifactにはCivitai Model/Version/File IDを捏造しない。保存する `fileName` は各用途ディレクトリからの相対パスであり、Local/R2どちらに存在するかは環境依存のためArtifactへ固定しない。配置確認時に現在のLocal/R2状態を再評価する。

Animaで `diffusionModel` / `textEncoder` / `vae` が欠けた状態は blocking error とする。schemaVersion 5 のAnimaに `checkpoint` / `clip` を保存することも許可しない。Illustriousには `diffusionModel` / `textEncoder` / `vae` を保存しない。

## Grok contract

Grok の Model工程は LoRA selection のみを担当する。返却ファイルは `model_loras.json` とし、`checkpoint` / `diffusionModel` / `textEncoder` / `clip` / `vae` / `modelFamily` を含む回答はBatch Studioが拒否する。Batch Studioがユーザー選択済み基盤モデルへ `loras[]` だけをmergeして `models.json` Draftを構築する。

## Prompt dialect

- Illustrious: 通常のDanbooruタグは underscore (`looking_at_viewer`)。
- Anima: 通常タグは space (`looking at viewer`)。
- `trainedWords` はModel Familyに関係なくcatalog文字列を完全一致で使用し、変換しない。

Model Familyは `project_brief.json` にも保存し、Prompt Plan依頼時に明示的なdialect ruleへ変換する。モデル名からdialectを推測しない。

Workflow生成時は models.modelFamily に従って標準ノードを組み立てる。追加custom_nodesや独自model modeは使用しない。画像実行の正本は[標準画像実行契約](../architecture/standard-image-execution.md)とする。

## Placement lookup

schemaVersion 5 は選択時・実行前確認時ともに用途別ディレクトリを厳密に使用する。

```text
Local:
  Illustrious:
    <ComfyUI>/models/checkpoints/<checkpoint file>

  Anima:
    <ComfyUI>/models/diffusion_models/<diffusionModel.fileName>
    <ComfyUI>/models/text_encoders/<textEncoder.fileName>
    <ComfyUI>/models/vae/<vae.fileName>

R2:
  Illustrious:
    <r2ModelPrefix>/<checkpoint file or existing checkpoint placement>

  Anima:
    <r2ModelPrefix>/diffusion_models/<diffusionModel.fileName>
    <r2ModelPrefix>/text_encoders/<textEncoder.fileName>
    <r2ModelPrefix>/vae/<vae.fileName>
```

`r2ModelPrefix` が空の場合はR2 bucket直下の各用途ディレクトリを使用する。ローカル実行ではローカル配置必須・R2任意、リモート実行ではR2配置必須・ローカル任意、という既存配置ポリシーを維持する。

## Workflow templates

Workflowは Model Family ごとに別テンプレートを持つ。

```text
templates/
  illustrious-scene-batch/
    template.json
    manifest.json
  anima-scene-batch/
    template.json
    manifest.json
```

Templateはcontract、modelFamilyとgeneration defaultsを保持し、ManifestはTemplateのidentityとSHA-256を保持する。旧Manifestのcommon rolesやノードIDによるpatchは使用しない。

### Illustrious

CheckpointLoaderSimple のMODEL / CLIPをRoot、Branchの順で標準LoraLoaderへ接続し、VAEをVAEDecodeへ接続する。各Leafのlatentには EmptyLatentImage を使用する。

### Anima

UNETLoader のMODELと CLIPLoader のCLIPをRoot、Branchの順で標準LoraLoaderへ接続し、VAELoader のVAEをVAEDecodeへ接続する。各Leafのlatentには EmptySD3LatentImage を使用する。

### 共通の組み立て

Compilerは models.modelFamily でTemplateを選び、models.json / prompt_plan.json / generation defaultsから標準API graphを構築する。各LoraLoaderはMODEL / CLIP strengthを独立に保持し、LoRAがない場合は直結する。Batch Studioが合成したPositive / NegativeをCLIPTextEncodeへ渡し、各Leafにlatent（batch_size=1）、KSampler、VAEDecode、SaveImageを作成する。SceneMatrix / ScenePrompterExpand / SceneEmptyLatentは使用しない。

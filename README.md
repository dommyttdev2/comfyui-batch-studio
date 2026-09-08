# ComfyUI Batch Studio

ComfyUI の大量画像生成プロジェクトを、企画から Story、モデル選定、Prompt Plan、Workflow 生成、モデル配置確認、Preflight まで一貫して管理する Electron デスクトップアプリです。

## v1 implementation

- Electron `BaseWindow` + Local/Grok `WebContentsView`
- Grok 専用 persistent session と信頼境界分離
- Project 作成 / 再読込 / 設定
- `project_brief.json`
- Story Draft / Import / History / Confirm
- Grok 用依頼文生成と手動 Copy / Paste workflow
- `model_catalog.json` 読込・世代表示・Model/Version/File identity 検証
- `models.json` Draft / Confirm / missingRequirements blocking
- Civitai `strengthBaseline` provenance 表示と Prompt Plan への実適用値分離
- `prompt_plan.json` schema/semantic validation、Draft / Confirm
- 左→右の擬似 Workflow Tree による Prompt Plan レビュー
- Common Prompt / Root LoRA / Branch LoRA / Matrix / Leaf 編集
- 実 Workflow から抽出した bundled Template + Manifest
- Branch Prototype clone による deterministic Workflow Compiler
- `LoRA_{project.id}.json` 出力
- Local/R2 inventory による Model Availability
- READY / BLOCKED Preflight

Grok Web はユーザーが手動操作します。Batch Studio は DOM 操作、自動送信、自動添付、回答 scraping を行いません。

## Development

Requirements:

- Node.js 22+
- npm 10+

```bash
npm install
npm run typecheck
npm run dev
```

Production build:

```bash
npm run build
npm start
```

## Built-in Workflow Template

`templates/default-scene-batch/` に v1 の標準 Workflow Template と Manifest を同梱しています。プロジェクト設定で別 Template / Manifest を指定することもできます。

詳細仕様は `docs/` を参照してください。

# Workflow Compiler Architecture

Status: Active / Compiler 3 / Manifest Schema 2 / Template 3

詳細な実行契約は[標準画像実行](standard-image-execution.md)を正本とする。

## 入力と出力

Batch Studioが確定済みmodels.jsonとprompt_plan.jsonからUI WorkflowとAPI graphを機械生成する。GrokにはComfyUIのnode ID、link、widgetsを生成させない。

Templateはモデル系統と生成設定（width、height、steps、cfg、sampler_name、scheduler、denoise）を持つcontract 1のJSON。Manifest schema 2はTemplate ID、version、SHA-256を持つ。改行LF/CRLFを正規化してTemplate hashを照合する。旧prototype graph・Manifest schema 1は拒否する。

UI出力名はLoRA_{Project実フォルダの親フォルダ名}.json、API出力名は同名の.api.json。project_meta.json.workflowBuildにCompiler/Template/Manifest version、モデル入力hash、UI/API hash、workflowIdentity、Branch数とLeaf総数を保存する。変更されていない入力は同じgraphとhashを生成する。

## グラフ生成

IllustriousはCheckpointLoaderSimple、AnimaはUNETLoader + CLIPLoader + VAELoaderを使用する。AnimaのlatentはEmptySD3LatentImage、IllustriousはEmptyLatentImage。

モデル → Root LoraLoader N個 → Branch LoraLoader N個 → LeafごとのCLIPTextEncode positive/negative → KSampler → VAEDecode → SaveImage。

LoRAを0個選んだ場合は直接接続する。RootとBranchの適用順を維持し、strength_modelとstrength_clipを独立して渡す。BranchのLoRAを他のBranchへ流用しない。共通・Branch・LeafのプロンプトはBatch Studioが合成し、CLIPTextEncodeへ最終文字列を渡す。

Prompt Plan schema 2では品質policy、選択したモデルのtrainedWords、カテゴリ順、exact dedupeを既存Prompt Compilerで適用する。Schema 1の入力文字列はopaque textとして連結する。weightやtrainedWordsの暗黙変換は行わない。これは入力Prompt Planの契約であり、旧custom-node Workflowの実行互換性を意味しない。

## 画像ごとの実行単位

1 Leaf = 1 KSampler = batch_size 1 = 1 SaveImage。SaveImageの_meta.batchStudioにcontract: 1、branchId、leafIdを保存する。このbindingはAPI hashに含める。Planの全LeafとSaveImageの対応は一対一で検証する。

実行時は各SaveImageとその祖先だけを抽出し、Planのarray orderで1画像ずつPOST /promptする。単一taskに複数samplerやbatch_size > 1は認めない。グラフの参照切れ、循環、標準node allowlist外の型、重複bindingを拒否する。

Run作成時にseedを画像ごとに確定し、seedを含むUI/APIをimmutable snapshotへ保存する。プロジェクトのpreview seedは0。Resumeはsnapshotの同じseedと入力を再使用する。旧Runは新Runを作り直す。

## 出力と検証

実行時のfilename_prefixはBatchStudio/{project.id}/{run.id}/{branch.id}/{leaf.id}。SaveImageがsequenceを付加する。取得する画像はHistoryのfilename/subfolderを正本とし、Run配下のpath containment、件数1、size、SHA-256を検証する。

PNGには送信graphと一致する画像単位のUI Workflowをextra_data.extra_pnginfo経由で渡す。Run証跡・Remote manifestにはBranch/Leaf/prompt IDと実画像の対応を記録する。PNG metadataが無効の場合もRun snapshotと証跡が正本である。

旧Template/Manifest/Workflow/Runの変換、旧custom endpointへのfallback、custom-node repositoryの同期設定は提供しない。保存済みデータを削除せず、Workflow再生成と新Run作成を案内する。

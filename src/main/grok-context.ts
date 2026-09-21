import path from 'node:path';
import type { GrokTask, ModelFamily, ModelsArtifact, PromptPlanArtifact } from '../shared/types.js';
import { exists, readJson } from './fs-utils.js';
import { catalogPathFor } from './model-catalog.js';
import { validatePromptPlan } from './validation.js';

async function attachment(name: string, p: string, purpose: string) {
  return { name, path: p, purpose, exists: await exists(p) };
}
const common = `あなたは ComfyUI Batch Studio の企画工程を支援します。
Batch Studio と生成アシスタントの責務境界を守ってください。
- あなたは意味・創作上の判断を担当します。
- ComfyUI Workflow JSON、node ID、link ID、group ID、node position、widgets_values は生成しません。
- 添付ファイルに存在しない Model / Version / File identity を捏造しません。`;
export const artifactFileOutputRules = (fileName: string) => `## 出力契約（必須）
- 完成した内容を全て記載した UTF-8 のプレーンテキストファイル（名前: ${fileName}）を作成し、チャット上でダウンロード可能な添付ファイルとして返してください。
- 最終成果物はチャット本文へ展開せず、\`${fileName}\` という名前のダウンロード可能なファイルとして生成・添付してください。
- ファイルを作成したと報告するだけでは納品になりません。「作成しました」「ファイルパス:」などの説明文、空のパス、ファイル名だけの表示は成果物ではありません。
- 実際に添付ファイルを提供できない場合に限り、代替として完全なファイル本文だけを一つの Markdown code block に入れて出力してください。\`${fileName}\` が .md なら markdown、.json なら json のコードブロックを用います。Batch Studioがこの本文を検証して自動取り込みします。
- 添付ファイルがある場合、ファイル内容をチャット本文、code block、引用、要約へ再掲しません。
- 添付ファイル・代替code blockのいずれも提供できない場合は、実ファイルを作成したと主張せず、生成できなかった理由を明示してください。
- チャット本文には成果物外の挨拶、説明、要約、ファイルパス、追加質問を付けません。
- 指定された形式・見出し・field以外を追加しません。`;
const storyDiscussionShape = `## 出力形式
次の見出し順で回答してください。これは検討用回答であり code block には入れません。
# 調査・前提
- 確認できた公開情報
- 不確かな点 / 推測禁止事項

# Story案
## 案A: <短いタイトル>
- コンセプト:
- 大まかな進行:
- 画像化しやすい場面:
- 展開上の特徴:

## 案B: <短いタイトル>
- コンセプト:
- 大まかな進行:
- 画像化しやすい場面:
- 展開上の特徴:

必要に応じて案C以降を追加して構いません。

# 確認事項
- ユーザーが決めるべき点を箇条書きで示してください。`;
const storyShape = `${artifactFileOutputRules('story.md')}
story.md 本文を次の見出し順で記述してください。

# <作品タイトル>

## 作品コンセプト
- 作品全体の狙い、雰囲気、進行方針を記述します。

## 登場人物
- 主要人物ごとに、役割・関係性・外見上重要な特徴・性格上重要な特徴を記述します。
- 添付資料や公開情報で確認できない設定を事実として補完しません。

## 共通設定
- 舞台、時間帯、世界観、継続して維持すべき状態や前提を記述します。

## 全体進行
- 冒頭から終盤までの変化を段階的に記述します。

## シーン構成
### Scene 1: <短い場面名>
- 目的:
- 状況・場所:
- 登場人物の状態:
- 主な出来事:
- 視覚的に重要な要素:
- 次シーンへの変化:

### Scene 2: <短い場面名>
- 以降も同じ項目で必要なだけ続けます。

## 生成上の一貫性メモ
- 後段のPrompt Planで維持すべき外見、衣装、関係性、舞台、進行上の制約を箇条書きで記述します。

制約:
- Prompt Planそのもの、LoRA選定、Checkpoint選定、ComfyUIノード情報は書きません。
- Prompt Planでscope分離できるよう、全編で不変の外見・関係性・舞台と、途中で変化する衣装・状態・場所を区別して記述します。
- Scene内で個別画像のpositive/negative promptは書きません。
- 上記の最上位見出しを省略・改名・追加しません。`;
const loraFallbackDecisionRules = `## LoRA不足時の必須探索順序
Story上必要な表現ごとに、次の順序を必ず守って解決してください。途中の段階で解決できた場合は、それ以降へ進みません。
1. まず添付 model_catalog.json 内の LoRA / LoCon / DoRA から、要件を直接満たす候補を探します。
2. model_catalog.json に適切な候補が無い場合、Web検索を行い、\`civitai.red\` と \`civitai.com\` の両方から代替LoRAを探します。モデル名だけでなく、用途・Base Model・Version・trained words等を確認してください。
   - 外部検索で適切な代替LoRAが見つかっても、model_catalog.json に存在しない Model / Version / File identity を loras に出力してはいけません。
   - その場合は missingRequirements に記録し、reason に見つけたモデル名、URL、用途、および「Civitai Collectionへ追加してカタログ再同期が必要」である旨を書きます。この状態は未解決です。
3. civitai.red / civitai.com のどちらでも適切な単一代替LoRAが見つからない場合、model_catalog.json 内の複数LoRAを組み合わせて要件を分解・実現できるか調査します。
   - 組み合わせで実現可能なら必要な複数LoRAを loras に選定し、各 reason にそのLoRAが担う役割を明記します。この要件を missingRequirements へ入れません。
4. 複数LoRAでも適切に実現できない場合、LoRAを使わず positive / negative prompt で十分に代替可能か判断します。
   - Promptだけで十分に代替可能と判断した場合は promptFallbacks に記録し、その要件を missingRequirements へ入れません。これは解決済みとして扱います。
   - Prompt代替では再現性が不足すると判断した場合だけ missingRequirements に残します。
5. 「見つからない」だけで直ちに missingRequirements にしてはいけません。必ず 2 → 3 → 4 の調査を完了してください。`;
function loraCheckpointPriorityRules(base: any) {
  const checkpointVersionId = Number(base?.checkpoint?.versionId);
  if (!Number.isInteger(checkpointVersionId) || checkpointVersionId <= 0)
    return `## 基盤Checkpoint一致の優先
- models.json に checkpoint.versionId が無いため、observedCheckpoints による正確なCheckpoint一致優先は適用しません。
- baseModel名だけから具体的なCheckpoint identityを推測してはいけません。`;
  return `## 基盤Checkpoint一致の優先
- models.json でユーザーが選択済みの基盤Checkpoint Version IDは ${checkpointVersionId} です。このidentityは変更しません。
- model_catalog.json の LoRA / LoCon / DoRA 各Versionにある observedCheckpoints は、Civitai作例画像の meta.civitaiResources から実際に観測したCheckpoint利用実績です。LoRAの学習元Checkpointを示す情報ではありません。
- Story要件を十分満たす候補同士を比較するとき、observedCheckpoints[].modelVersionId が ${checkpointVersionId} と完全一致するVersionを最優先してください。
- observedCheckpoints が無い、または空のVersionはCheckpoint不明です。一致しないと断定せず、完全一致する適切な候補が無い場合の次点として検討してください。
- observedCheckpoints が存在しても ${checkpointVersionId} が含まれないVersionは、同一Checkpointでの作例実績を確認できていない候補として優先度を下げます。ただし互換性が無い、または使用禁止とは断定しません。
- Checkpoint一致は意味適合性を置き換えません。Story要件を満たさないLoRAを一致だけを理由に選んではいけません。
- observedCheckpoints のModel / Version identityは推測・書き換えず、model_catalog.jsonに記録された値だけを根拠にしてください。`;
}
const lorasShape = `${artifactFileOutputRules('model_loras.json')}
model_loras.json は次の形だけにしてください。
{
  "schemaVersion": 1,
  "loras": [
    {
      "ref": "lora.<semantic-id>",
      "modelId": <integer>, "modelName": "...", "versionId": <integer>, "versionName": "...",
      "fileId": <integer>, "fileName": "...", "modelUrl": "...", "trainedWords": ["..."], "reason": "...",
      "strengthBaseline": <catalogの選択versionに存在する場合だけ、そのobjectを値・provenanceとも変更せずコピー>
    }
  ],
  "promptFallbacks": [
    {
      "requirement": "LoRAで満たせなかった表現要件",
      "positiveTags": ["positive promptへ追加するDanbooru実在タグ"],
      "negativeTags": ["negative promptへ追加するDanbooru実在タグ"],
      "reason": "なぜLoRAなしでPrompt代替が十分と判断したか"
    }
  ]
}
- Checkpoint、Text Encoder、VAE、modelFamily は出力しません。添付された選択済み models.json の基盤モデルはユーザー確定値であり変更禁止です。
- loras に出力できるのは model_catalog.json の modelType が LoRA / LoCon / DoRA の候補だけです。
- JSONとしてparse可能な厳密な構文にしてください。コメント、末尾カンマ、擬似値は出力しません。
- ref は project 全体で一意にしてください。LoRA ref は ^lora\\.[a-z][a-z0-9._-]{0,58}$ に従います。
- loras の ID / name / URL / trainedWords / strengthBaseline は model_catalog.json から正確に転記してください。
- promptFallbacks はPromptだけで十分に代替可能と判断した要件だけを入れます。requirement / reason は空にせず、positiveTags / negativeTags の少なくとも一方を1件以上指定してください。
- positiveTags / negativeTags は1配列要素につき1つのDanbooruタグだけを入れ、カンマ区切り文字列にはしません。
- promptFallbacks が無い場合は promptFallbacks を出力しません。
- 全探索を行っても解決できない要件、または外部Civitai上に候補が見つかったがカタログ未登録の要件だけ、root の missingRequirements 配列へ {"role":"lora","requirement":"...","reason":"..."} を記載してください。
- 不足が無い場合は missingRequirements を出力しません。
- 定義されていない追加フィールドを出力しません。`;
const planShape = `${artifactFileOutputRules('prompt_plan.json')}

## Schema v2 JSON構造
prompt_plan.json は Schema v2 の構造化Promptとして出力してください。
{
  "schemaVersion": 2,
  "triggerWordsMode": "selected",
  "common": {
    "triggerWords": [],
    "positive": {
      "subject": [],
      "identity": [],
      "appearance": [],
      "style": []
    },
    "negative": {}
  },
  "rootLoras": [
    { "modelRef": "lora.xxx", "strengthModel": 0.0, "strengthClip": 0.0 }
  ],
  "branches": [
    {
      "id": "b01",
      "label": "人間向け表示名",
      "loras": [
        { "modelRef": "lora.xxx", "strengthModel": 0.0, "strengthClip": 0.0 }
      ],
      "prompt": {
        "triggerWords": [],
        "positive": {
          "outfit": [],
          "environment": []
        },
        "negative": {}
      },
      "leaves": [
        {
          "id": "s1-01-c1",
          "name": "S1-01_C1_example",
          "prompt": {
            "triggerWords": [],
            "positive": {
              "expression": ["smile"],
              "pose": ["standing"],
              "camera": {
                "angle": ["from_below"],
                "framing": ["cowboy_shot"],
                "gaze": ["looking_at_viewer"]
              }
            },
            "negative": {}
          }
        }
      ]
    }
  ]
}

## 出力構造の厳守（全Branch・全Leafで例外なし）
- 上記JSONは構造の例示です。id、名前、modelRef、タグやLoRA値を例示から機械的にコピーせず、添付したStoryとmodels.jsonを正本にしてください。
- 全Branchで id、非空のlabel、loras配列、leaves配列を必ず出力してください。idはlabelの代用になりません。使用LoRAが無いBranchも必ず"loras": []を出力します。
- 全Leafで id、非空のname、promptを必ず出力してください。idはnameの代用になりません。promptにはpositiveとnegativeのobjectを必ず出力し、タグを追加しない場合でもそれぞれ{}を出力します。
- 共通のフィールドが繰り返されても省略・圧縮・キー名変更をしません。500枚など大量のLeafでも各Leafを完全な独立objectとして出力してください。
- 配列の途中で説明文や「同様」などの省略表現を挿入せず、全Branch・全Leafを構造どおりに記述してください。
- BranchとLeafの表示名は、そのシーンや画像を識別できる具体的な名前にしてください。枝葉の数を増やすためだけの無内容な重複画像を追加しません。

## Scopeルール
- common には全Branch・全Leafで不変のタグだけを置いてください。
- branch.prompt にはそのBranch配下の全Leafで不変のタグだけを置いてください。Branch共通タグが無い場合は prompt field 自体を省略できます。
- leaf.prompt にはその画像だけに必要な差分を置いてください。
- 親scopeに存在するタグを子scopeへ再掲してはいけません。
- 途中で変化する衣装、背景、状態を common へ置いてはいけません。
- common と各 leaf.prompt は positive / negative object を必ず持たせてください。空categoryは省略できます。
- 各Leafで意味のある差分（表情、動作、ポーズ、構図、衣装状態など）が必要ならleaf.prompt.positiveへ必ず記載してください。全Leafのpositiveを空にして済ませず、親Scopeから継承されるタグと画像固有の差分を区別してください。

## Positive category
使用可能なkeyは次だけです。
subject, identity, appearance, style, outfit, expression, action, pose, camera, environment, lighting, effects

camera は次のsubcategoryだけを使用できます。
pov, angle, framing, gaze, focus

- angle / framing / gaze はCommon→Branch→Leafを合成した最終画像につき各最大1タグです。同じsubcategoryを複数scopeで別値指定しても上書きされず、すべて残るので禁止します。
- 各画像で構図・視線が変わるならcamera.angle / camera.framing / camera.gazeはLeafだけに配置し、CommonとBranchには配置しません。全配下で本当に不変のときだけ親scopeへの配置を許可します。
- 例えばBranchでmedium_shot、Leafでclose-upと書くと2タグの競合です。画像ごとの構図はLeafのframingに1つだけ指定してください。
- camera.pov・camera.focusなども親子の重複や意味の矛盾を防ぎます。
- 競合する構図タグを同じ最終画像に指定しません。
- expression は原則3タグ以内とします。

## Negative category
使用可能なkeyは次だけです。
anatomy, identity, appearance, subject, outfit, action, camera, environment, artifacts, content

- Project固有で除外する必要がある内容だけを記述してください。
- 一般的なquality/anatomy presetを大量に生成しません。Batch StudioがModel Family policyとして付与します。
- 同一タグをpositiveとnegativeの両方へ入れてはいけません。

## Tag形式
- 1配列要素 = 1タグです。カンマ区切りの複数タグを1文字列へ入れてはいけません。
- 同じタグを同一categoryや親子scopeへ重複させません。
- 衣装の変化はBranchまたはLeafに置き、すべての画像へ残り続けるCommonに置きません。nude系タグとoutfitタグが共存する場合は意図した部分的な着衣状態だけに限定し、意味が矛盾するなら片方を除きます。
- 通常タグはDanbooru canonical tagを使用してください。
- Illustriousではunderscore形式、Animaではspace形式を使用します。

## トリガーワード選定
- triggerWordsMode は必ず "selected" にしてください。これによりCompilerは models.json の trainedWords を自動注入しません。
- models.json の checkpoint / diffusion model / LoRA trainedWords は利用可能な候補です。全件転記せず、Storyと各シーンの衣装・ポーズ・構図・キャラクター同一性に必要なワードだけを選んでください。
- common / branch.prompt / leaf.prompt の triggerWords は {"modelRef":"models.json内のref","words":["そのモデルのtrainedWordsから選んだ原文"]} の配列です。modelRef ごとにまとめ、使わない場合は空配列またはfield省略とします。
- commonで選ぶのは全画像に本当に必要なワードだけです。root LoRAのワードであっても、特定シーンだけに必要な場合はbranch.promptかleaf.promptで選んでください。
- commonでは基盤モデルおよびrootLoras、branch.promptとleaf.promptでは基盤モデル・rootLoras・当該branch.lorasからのみ選択できます。
- LoRAを使用してもワードが不要ならwordsを空にするか、選択自体を省略してください。候補を全件選択したり、最低1語選択したりする義務はありません。
- どのscopeでも選択しなかった候補は最終Promptに加えません。Compilerによる補完もありません。
- 選択する語はmodels.jsonの当該modelRefのtrainedWordsと完全一致させ、変換・翻訳・正規化しません。前後に空白・改行を含む候補は選ばず、候補にない語句を自作しません。通常Danbooruタグのカテゴリへ混入させず、triggerWordsに分離してください。
- ある語が親scopeで既に選択されているなら子scopeでは重複選択しません。

## LoRA
- modelRef は models.json に存在する LoRA ref だけを使ってください。
- models.json に strengthBaseline.value = w があるLoRAは、初期値として strengthModel=w / strengthClip=w を使用してください。
- strengthBaseline が無いLoRAも strengthModel / strengthClip は必須です。暗黙defaultで埋めず、Storyと用途から明示的に値を決めてください。

## Prompt fallback
- model_prompt_fallbacks.json が添付されている場合、positiveTags / negativeTags はLoRA不足をPromptで解決済みと判断したタグです。
- requirement と Story を照合して、該当する common / branch.prompt / leaf.prompt の適切なcategoryへ分類してください。
- 無関係なSceneへ一律適用しません。
- fallbackタグを省略したり反対の意味へ変更したりしません。重複だけは1回にまとめて構いません。

## Identity / ordering
- Branch / Leaf id は ^[a-z][a-z0-9._-]{0,63}$ に従い、各々project全体で一意にしてください。
- 配列順が生成順です。order field は追加しません。
- 1 Leaf = 1 image です。目標画像枚数に近づくようLeaf数を設計してください。ただし意味上必要なら目標と完全一致しなくても構いません。
- common / rootLoras / branches / branch.prompt / leaves / leaf.prompt と triggerWordsMode / triggerWords の意味情報だけを出力し、Workflow内部fieldや未知fieldを追加しません。
- Negativeに許されるキーは「Negative category」に列挙したものだけです。negative.expressionなどPositive専用categoryは出力しません。

## ファイル出力前の全件チェック
- Branch件数と各BranchのLeaf件数を数え、全Branchにid・label・loras・leaves、全Leafにid・name・prompt.positive・prompt.negativeがあるか全件確認します。表示名の欠落を許容しません。
- Common/Branch/Leaf合成後の各Leafについてcamera.angle / framing / gazeの競合、同一タグの親子重複、Positive/Negativeの同一タグ混在、衣装状態の矛盾を確認し、修正してから出力します。
- triggerWordsはmodelRefごとにmodels.jsonのtrainedWordsに実在する完全一致候補か確認し、余分な空白や改行を入れません。
- schemaにないfieldを出力せず、全Leaf数が計画の目標枚数と整合するか実際に数えて確認します。
- JSONとしてparse可能な厳密な構文にしてください。コメント、末尾カンマ、擬似値は出力しません。`;
const captionShape = `${artifactFileOutputRules('caption_content.json')}
caption_content.json は次の形だけにしてください。
{
  "schemaVersion": 1,
  "title": { "ja": "...", "en": "..." },
  "description": {
    "ja": ["段落1", "段落2"],
    "en": ["Paragraph 1", "Paragraph 2"]
  },
  "contents": {
    "ja": ["内容1", "内容2"],
    "en": ["Content 1", "Content 2"]
  }
}
- JSONとしてparse可能な厳密な構文にしてください。コメント、末尾カンマ、擬似値は出力しません。
- title と description は必須です。ja / en の両方を作成してください。
- description は段落単位の文字列配列にしてください。
- description.ja[0] / description.en[0] は、作品の導入として官能的な短いストーリーにしてください。各200文字以内で簡潔にまとめ、日本語と英語で意味を対応させてください。
- contents は作品内容を短い一覧として示す価値がある場合だけ追加する任意fieldです。不要ならfield自体を出力しません。
- 画像枚数、収録枚数、生成枚数は出力しません。最終成果物ディレクトリの実ファイル数をBatch Studioが挿入します。
- 「二次創作です」「公式とは無関係です」「AI生成作品です」等の定型注意書きは出力しません。Batch Studioが付加します。
- Markdown見出し、code block、caption.txt完成形、ComfyUI情報、未定義fieldは出力しません。
- 日本語と英語で作品内容の意味が対応するようにしてください。`;
const danbooruTagRules = `## Danbooruタグ選定ルール
画像生成に使用する positive / negative prompt の通常タグは、Danbooruで実在するタグを使用してください。
- 自由作文の英語フレーズや、Danbooruに存在しない独自タグを新しく作ってはいけません。
- Danbooruのcanonical tagを基準にし、aliasがある場合はalias先のcanonical tagを優先してください。
- 同じ、またはほぼ同じ視覚的意味を表現できるタグ候補が複数ある場合は、意味の正確性を第一条件とし、その条件を満たす候補の中でDanbooruのpost_countが多いタグを優先してください。
- post_countが少ない特殊なタグより、意味を十分維持できる使用頻度の高い一般的なタグを優先してください。
- 低頻度タグしか正確に意味を表現できない場合は使用可能です。意味を損なわず高頻度タグへ置換できる場合だけ置換してください。
- 高頻度という理由だけで、Storyが要求する意味と異なるタグへ置換してはいけません。
- 複雑な表現をDanbooruに存在しない1個の合成タグとして作らず、必要に応じて複数の実在Danbooruタグへ分解してください。
- Danbooruタグか不確かな語を推測だけで採用せず、必要に応じてDanbooruのタグ情報を確認してください。
- post_countを確認できない場合、件数を捏造してはいけません。その場合も実在確認と意味の正確性を優先してください。

### Model記法との関係
- 実在確認・canonical判定・post_count比較は、underscoreを含むDanbooru canonical nameを基準に行ってください。
- Illustriousではcanonical nameをunderscore形式でpromptへ出力してください。
- Animaでは同じcanonical tagを確認したうえで、prompt出力時だけunderscoreをspaceへ変換してください。例: Danbooru canonical tagが \`looking_at_viewer\` の場合、Illustriousは \`looking_at_viewer\`、Animaは \`looking at viewer\` とします。

### 例外
- models.json の trainedWords と、そこから変更せず転記するCheckpoint / LoRA等のトリガーワードにはDanbooruタグ制約を適用しません。
- trainedWordsはDanbooruに存在しなくても削除・翻訳・正規化・別タグへの置換をせず、models.jsonの文字列をそのまま使用してください。`;
function dialectRule(family: ModelFamily | undefined) {
  if (family === 'anima')
    return `## Prompt記法 — Anima\n- trainedWordsとしてカタログから転記する文字列を除き、Danbooru系の通常タグは単語間をスペースで記述してください。例: \`looking at viewer\`, \`long hair\`, \`from below\`.\n- 通常タグを underscore 形式へ変換しません。\n- trainedWords は例外で、models.json に記録された文字列を1文字も変更せずそのまま使用します。`;
  return `## Prompt記法 — Illustrious\n- trainedWordsとしてカタログから転記する文字列を除き、Danbooru系の通常タグは underscore 形式で記述してください。例: \`looking_at_viewer\`, \`long_hair\`, \`from_below\`.\n- 通常タグをスペース区切りへ変換しません。\n- trainedWords は例外で、models.json に記録された文字列を1文字も変更せずそのまま使用します。`;
}

export async function buildGrokTask(
  root: string,
  stage: GrokTask['stage'],
  extra = '',
): Promise<GrokTask> {
  if (stage === 'prompt-plan-patch')
    throw new Error('部分修正用の差分生成はCodex Paneから実行してください。');
  const brief = path.join(root, 'project_brief.json'),
    story = path.join(root, 'story.md'),
    models = path.join(root, 'models.json'),
    modelsDraft = path.join(root, '._batch_studio', 'drafts', 'models.json'),
    promptFallbacks = path.join(root, '._batch_studio', 'model_prompt_fallbacks.json');
  const catalog = await catalogPathFor(root);
  if (stage === 'story-initial')
    return {
      stage,
      title: 'ストーリー検討',
      prompt: `${common}\n\n## Task\n添付した project_brief.json を基に、まだ story.md を確定せず、ユーザーとの対話用に検討材料を提示してください。\n1. 公開情報を調査して前提を整理する。版権キャラクターの不確かな設定は推測で確定しない。\n2. 大まかなStory案を複数提示する。\n3. 各案について画像化しやすさ・展開上の特徴を示す。\n4. ユーザーが決めるべき点や不足情報を質問する。\n\n${storyDiscussionShape}${extra ? `\n\nユーザー追加入力:\n${extra}` : ''}`,
      attachments: [await attachment('project_brief.json', brief, '基本設定')],
    };
  if (stage === 'story-finalize' || stage === 'story-fix')
    return {
      stage,
      title: stage === 'story-finalize' ? 'ストーリー完成版' : 'ストーリー修正',
      prompt: `${common}\n\n## Task\n検討は完了しています。これまでの会話でユーザーが確定した事項と添付された基本設定${stage === 'story-fix' ? '・現在の story.md' : ''}を基に、検討案・質問ではなく、画像生成計画へ展開可能な完成版 story.md の全文を納品してください。以前の検討用プロンプトの見出し（調査・前提、Story案、確認事項）で回答してはいけません。章・場面・進行が追える構造にし、Prompt PlanそのものやComfyUI内部情報は書かないでください。出力するのは実際のダウンロード可能な story.md（添付不可なら上記出力契約に従う完全な本文）であり、「作成しました」という完了報告だけではいけません。\n\n${storyShape}${extra ? `\n\n修正意図:\n${extra}` : ''}`,
      attachments: [
        await attachment('project_brief.json', brief, '基本設定'),
        ...(stage === 'story-fix'
          ? [await attachment('story.md', story, '現在の確定ストーリー')]
          : []),
      ],
    };
  if (stage === 'models' || stage === 'models-fix') {
    const basePath = (await exists(modelsDraft)) ? modelsDraft : models,
      base = await readJson<any>(basePath),
      family = base?.modelFamily as ModelFamily | undefined;
    return {
      stage,
      title: stage === 'models' ? 'LoRA選定' : 'LoRA再選定',
      prompt: `${common}\n\n## Task\n確定済み story.md と、ユーザーが選択済みの基盤モデルを記録した models.json を前提に、Story上必要なLoRAを選定してください。Checkpoint、Text Encoder、VAE、modelFamily はユーザーの責務であり、変更・再選定・代替提案をしません。trained words、採用理由、用途を考慮してください。\n\n${loraCheckpointPriorityRules(base)}\n\n${loraFallbackDecisionRules}\n\n${dialectRule(family)}\n\n${danbooruTagRules}\n\n${lorasShape}${extra ? `\n\n再選定条件:\n${extra}` : ''}`,
      attachments: [
        await attachment('story.md', story, '確定ストーリー'),
        await attachment('models.json', basePath, 'ユーザー選択済み基盤モデル（変更禁止）'),
        ...(catalog
          ? [await attachment('model_catalog.json', path.resolve(catalog), 'モデルカタログ')]
          : []),
        ...(stage === 'models-fix' && (await exists(promptFallbacks))
          ? [await attachment('model_prompt_fallbacks.json', promptFallbacks, '現在のPrompt代替策')]
          : []),
      ],
    };
  }
  if (stage === 'caption')
    return {
      stage,
      title: 'キャプション本文生成',
      prompt: `${common}\n\n## Task\n確定済みの基本設定・Story・Prompt Planを基に、最終作品のcaption.txtへ使用するタイトルと説明文を日本語・英語で作成してください。description の最初の説明文は作品内容に沿った官能的な短いストーリーとし、200文字以内で簡潔にまとめてください。作品内容を要約する短い一覧が有用な場合だけ contents も作成してください。実際の収録画像枚数は手作業で選定・モザイク処理された最終成果物ディレクトリをBatch Studioが数えるため、あなたは枚数を推測・記載しないでください。\n\n${captionShape}${extra ? `\n\n追加条件:\n${extra}` : ''}`,
      attachments: [
        await attachment('project_brief.json', brief, '作品・キャラクター・基本設定'),
        await attachment('story.md', story, '確定ストーリー'),
        await attachment(
          'prompt_plan.json',
          path.join(root, 'prompt_plan.json'),
          '実際に画像化するシーン構成',
        ),
      ],
    };
  const briefData = await readJson<any>(brief),
    modelData = await readJson<ModelsArtifact>(models);
  const planDraft = path.join(root, '._batch_studio', 'drafts', 'prompt_plan.json');
  const currentPlan =
    stage === 'prompt-plan-fix'
      ? (await exists(planDraft))
        ? planDraft
        : path.join(root, 'prompt_plan.json')
      : null;
  if (stage === 'prompt-plan-fix' && (!currentPlan || !(await exists(currentPlan))))
    throw new Error('修正元のprompt_plan.jsonがありません。先にPrompt Planを生成してください。');
  const planToFix = currentPlan ? await readJson<PromptPlanArtifact>(currentPlan) : null;
  const issues = planToFix ? validatePromptPlan(planToFix, modelData).issues : [];
  const issueCounts = new Map<string, { count: number; examples: string[] }>();
  for (const issue of issues) {
    const entry = issueCounts.get(issue.code) ?? { count: 0, examples: [] };
    entry.count++;
    if (entry.examples.length < 2) entry.examples.push(`${issue.path ?? 'root'}: ${issue.message}`);
    issueCounts.set(issue.code, entry);
  }
  const fixContext =
    stage === 'prompt-plan-fix'
      ? `\n\n## 修正対象・検証結果
- 添付した現在のprompt_plan.jsonを修正対象として使い、正常なBranch/Leafのid・順序・内容を維持してください。問題のない画像を作り直したり、枚数を勝手に減らしたりしません。
- この会話で合意した修正内容（タグの削除や重複解消など）を、添付の全体JSONに反映してください。会話内の修正提案だけで終わらず、修正後の完成したprompt_plan.jsonを納品してください。
- b19だけ、特定のBranchだけ、差分パッチ、置換前後の断片、修正手順、説明文だけの回答は成果物ではありません。common / rootLoras / 全branches / 全leaves を含む Schema v2 の完全なJSONを、元の枚数とidを維持して出力してください。
- JSON全文を一度に出力できない場合は、修正が完了したと報告せず、出力できない理由を明示してください。部分的なJSONを完成したprompt_plan.jsonとして渡してはいけません。
- 既存ファイルが構文不正ならまず構文を修正し、全件チェックを実施してください。
${[...issueCounts].map(([code, item]) => `- ${code}: ${item.count}件。例: ${item.examples.join(' / ')}`).join('\n') || '- 構造検証の指摘はありません。追加の修正条件があればそれを優先してください。'}`
      : '';
  const target = briefData?.generation?.target_image_count,
    family = modelData?.modelFamily as ModelFamily | undefined;
  return {
    stage,
    title: stage === 'prompt-plan' ? 'プロンプト設計' : 'プロンプト設計修正',
    prompt: `${common}\n\n## Task\n確定済み story.md と models.json を基に、Workflow Compilerへ渡す意味データとして Prompt Plan Schema v2 を作成してください。最終Prompt文字列を直接作らず、common / branch / leaf のscopeと意味categoryへDanbooruタグを構造化してください。models.json の trainedWords からシーンごとに必要な候補だけを triggerWords に選択してください。Compilerによるトリガーワードの自動注入は行いません。${Number.isInteger(target) ? `\n計画上の目標画像枚数は ${target} 枚です。` : ''}\n\n${dialectRule(family)}\n\n${danbooruTagRules}\n\n${planShape}${fixContext}${extra ? `\n\n修正条件:\n${extra}` : ''}`,
    attachments: [
      await attachment('project_brief.json', brief, '画像枚数などの計画条件'),
      await attachment('story.md', story, '確定ストーリー'),
      await attachment('models.json', models, '確定モデル・trainedWords（トリガーワード）'),
      ...(currentPlan
        ? [await attachment('prompt_plan.json', currentPlan, '現在のPrompt Plan（修正対象）')]
        : []),
      ...((await exists(promptFallbacks))
        ? [
            await attachment(
              'model_prompt_fallbacks.json',
              promptFallbacks,
              'LoRA不足をPromptで解決した代替策',
            ),
          ]
        : []),
    ],
  };
}

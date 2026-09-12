import path from 'node:path';
import type { GrokTask, ModelFamily } from '../shared/types.js';
import { exists, readJson } from './fs-utils.js';
import { catalogPathFor } from './model-catalog.js';

async function attachment(name: string, p: string, purpose: string) {
  return { name, path: p, purpose, exists: await exists(p) };
}
const common = `あなたは ComfyUI Batch Studio の企画工程を支援します。
Batch Studio と Grok の責務境界を守ってください。
- あなたは意味・創作上の判断を担当します。
- ComfyUI Workflow JSON、node ID、link ID、group ID、node position、widgets_values は生成しません。
- 添付ファイルに存在しない Model / Version / File identity を捏造しません。`;
const artifactFileOutputRules = (fileName: string) => `## 出力契約
- 最終成果物はチャット本文へ展開せず、\`${fileName}\` という名前のダウンロード可能なファイルとして生成・添付してください。
- ファイル内容をチャット本文、code block、引用、要約へ再掲しません。
- チャット本文には説明、挨拶、注釈、要約、注意書き、「以下です」「補足」等の成果物外テキストを付けません。
- ファイルは UTF-8 のプレーンテキストとして作成してください。
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
      "positive": "positive promptへ追加するDanbooru実在タグ列",
      "negative": "negative promptへ追加するDanbooru実在タグ列。不要なら空文字列",
      "reason": "なぜLoRAなしでPrompt代替が十分と判断したか"
    }
  ]
}
- Checkpoint、Text Encoder、VAE、modelFamily は出力しません。添付された選択済み models.json の基盤モデルはユーザー確定値であり変更禁止です。
- loras に出力できるのは model_catalog.json の modelType が LoRA / LoCon / DoRA の候補だけです。
- JSONとしてparse可能な厳密な構文にしてください。コメント、末尾カンマ、擬似値は出力しません。
- ref は project 全体で一意にしてください。LoRA ref は ^lora\\.[a-z][a-z0-9._-]{0,58}$ に従います。
- loras の ID / name / URL / trainedWords / strengthBaseline は model_catalog.json から正確に転記してください。
- promptFallbacks はPromptだけで十分に代替可能と判断した要件だけを入れます。requirement / reason は空にせず、positive / negative の少なくとも一方を空でない文字列にしてください。
- promptFallbacks が無い場合は promptFallbacks を出力しません。
- 全探索を行っても解決できない要件、または外部Civitai上に候補が見つかったがカタログ未登録の要件だけ、root の missingRequirements 配列へ {"role":"lora","requirement":"...","reason":"..."} を記載してください。
- 不足が無い場合は missingRequirements を出力しません。
- 定義されていない追加フィールドを出力しません。`;
const planShape = `${artifactFileOutputRules('prompt_plan.json')}
prompt_plan.json は次の形だけにしてください。
{
  "schemaVersion": 1,
  "common": { "positive": "...", "negative": "..." },
  "rootLoras": [ { "modelRef": "lora.xxx", "strengthModel": 0.0, "strengthClip": 0.0 } ],
  "branches": [
    {
      "id": "b01", "label": "人間向け表示名",
      "loras": [ { "modelRef": "lora.xxx", "strengthModel": 0.0, "strengthClip": 0.0 } ],
      "leaves": [ { "id": "s1-01-c1", "name": "...", "positive": "...", "negative": "..." } ]
    }
  ]
}
- JSONとしてparse可能な厳密な構文にしてください。コメント、末尾カンマ、擬似値は出力しません。
- Branch / Leaf id は ^[a-z][a-z0-9._-]{0,63}$ に従い、各々project全体で一意にしてください。
- 配列順が生成順です。order field は追加しません。
- 1 Leaf = 1 image です。目標画像枚数に近づくようLeaf数を設計してください。ただし意味上必要なら目標と完全一致しなくても構いません。
- modelRef は models.json に存在する LoRA ref だけを使ってください。checkpoint.main / text_encoder.main / vae.main / 旧schemaのclip.main はLoRA適用に使いません。
- models.json の trainedWords はトリガーワードとして扱い、文字列を変更・翻訳・正規化せず positive prompt に含めてください。
- checkpoint.main.trainedWords と rootLoras で参照する LoRA の trainedWords は common.positive に含めてください。
- Branch の loras で参照する LoRA の trainedWords は、その Branch 配下のすべての Leaf の positive に含めてください。
- trainedWords が空配列ならトリガーワードを捏造しません。同じ文字列が複数の適用元から重複する場合は、適用先の positive 内では1回にまとめてください。
- trainedWords を negative prompt へ入れません。
- models.json に strengthBaseline.value = w があるLoRAは、初期値として strengthModel=w / strengthClip=w を使用してください。
- strengthBaseline が無いLoRAも strengthModel / strengthClip は必須です。1.0や0.7等の暗黙defaultで埋めず、Storyと用途から明示的に値を決めてください。
- model_prompt_fallbacks.json が添付されている場合、その promptFallbacks はLoRA不足をPromptで解決済みと判断した要件です。各 requirement と Story を照合し、該当する common / Branch / Leaf の positive・negativeへ記録済み文字列を反映してください。無関係なSceneへ一律適用せず、必要な範囲へ配置してください。
- promptFallbacks の positive / negative は代替策として確定したPromptなので、省略したり反対の意味へ書き換えたりしません。重複だけは適用先Prompt内で1回にまとめて構いません。
- common / rootLoras / branches / leaves の意味情報だけを出力し、Workflow内部fieldや未知fieldを追加しません。`;
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
      prompt: `${common}\n\n## Task\nこれまでのGrok上の会話と添付された基本設定${stage === 'story-fix' ? '・現在の story.md' : ''}を基に、画像生成計画へ展開可能な完成 story.md を作成してください。章・場面・進行が追える構造にし、Prompt PlanそのものやComfyUI内部情報は書かないでください。\n\n${storyShape}${extra ? `\n\n修正意図:\n${extra}` : ''}`,
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
      prompt: `${common}\n\n## Task\n確定済み story.md と、ユーザーが選択済みの基盤モデルを記録した models.json を前提に、Story上必要なLoRAを選定してください。Checkpoint、Text Encoder、VAE、modelFamily はユーザーの責務であり、変更・再選定・代替提案をしません。trained words、採用理由、用途を考慮してください。\n\n${loraFallbackDecisionRules}\n\n${dialectRule(family)}\n\n${danbooruTagRules}\n\n${lorasShape}${extra ? `\n\n再選定条件:\n${extra}` : ''}`,
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
  const briefData = await readJson<any>(brief),
    modelData = await readJson<any>(models);
  const target = briefData?.generation?.target_image_count,
    family = modelData?.modelFamily as ModelFamily | undefined;
  return {
    stage,
    title: stage === 'prompt-plan' ? 'プロンプト設計' : 'プロンプト設計修正',
    prompt: `${common}\n\n## Task\n確定済み story.md と models.json を基に、Workflow Compilerへ渡す意味データとして Prompt Plan を作成してください。共通Prompt、全体共通LoRA、意味的なBranch分割、Branch LoRA、各Leafのpositive/negative差分を設計してください。models.json の trainedWords はトリガーワードとして、適用される positive prompt に必ず含めてください。${Number.isInteger(target) ? `\n計画上の目標画像枚数は ${target} 枚です。` : ''}\n\n${dialectRule(family)}\n\n${danbooruTagRules}\n\n${planShape}${extra ? `\n\n修正条件:\n${extra}` : ''}`,
    attachments: [
      await attachment('project_brief.json', brief, '画像枚数などの計画条件'),
      await attachment('story.md', story, '確定ストーリー'),
      await attachment('models.json', models, '確定モデル・trainedWords（トリガーワード）'),
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

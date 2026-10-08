import {
  artifactFileOutputRules,
  captionShape,
  common,
  danbooruTagRules,
  dialectRule,
  loraCheckpointPriorityRules,
  loraFallbackDecisionRules,
  lorasShape,
  planShape,
  promptPlanPatchInstructions,
  storyDiscussionShape,
  storyShape,
} from '../domain/agent-task-policy.js';
import type { ModelFamily, ModelsArtifact, PromptPlanArtifact } from '../domain/artifact-types.js';
import { validatePromptPlan } from '../domain/artifact-validation.js';
export type TaskStage =
  | 'story-initial'
  | 'story-finalize'
  | 'story-fix'
  | 'models'
  | 'models-fix'
  | 'prompt-plan'
  | 'prompt-plan-fix'
  | 'prompt-plan-patch'
  | 'caption';
export interface AgentTaskPlan {
  stage: TaskStage;
  title: string;
  prompt: string;
  attachments: { name: string; resourceId: string; purpose: string; exists: boolean }[];
}
export interface AgentTaskInputs {
  exists(resourceId: string): Promise<boolean>;
  json<T>(resourceId: string): Promise<T | null>;
  text?(resourceId: string): Promise<string | null>;
  hashText?(value: string): string;
  catalogResourceId(): Promise<string | null>;
}
async function attachment(
  ports: AgentTaskInputs,
  name: string,
  resourceId: string,
  purpose: string,
) {
  return { name, resourceId, purpose, exists: await ports.exists(resourceId) };
}
export async function buildAgentTask(
  ports: AgentTaskInputs,
  stage: TaskStage,
  extra = '',
): Promise<AgentTaskPlan> {
  if (stage === 'prompt-plan-patch') {
    const id = (await ports.exists('prompt-plan-draft')) ? 'prompt-plan-draft' : 'prompt-plan',
      text = await ports.text?.(id),
      plan = await ports.json<PromptPlanArtifact>(id),
      models = await ports.json<ModelsArtifact>('models');
    if (
      !text ||
      !ports.hashText ||
      plan?.schemaVersion !== 2 ||
      models?.schemaVersion !== 5 ||
      !validatePromptPlan(plan, models).valid
    )
      throw new Error('Current valid plan and confirmed models required.');
    const baseline = {
      baseSha256: ports.hashText(text),
      branches: plan.branches.length,
      leaves: plan.branches.reduce((sum, branch) => sum + branch.leaves.length, 0),
    };
    return {
      stage,
      title: 'Prompt Planを部分修正',
      prompt: promptPlanPatchInstructions(baseline, extra),
      attachments: [await attachment(ports, 'prompt_plan.json', id, '現在のPrompt Plan')],
    };
  }
  const brief = 'brief',
    story = 'story',
    models = 'models',
    modelsDraft = 'models-draft',
    promptFallbacks = 'model-prompt-fallbacks';
  const catalog = await ports.catalogResourceId();
  if (stage === 'story-initial')
    return {
      stage,
      title: 'ストーリー検討',
      prompt: `${common}\n\n## Task\n添付した project_brief.json を基に、まだ story.md を確定せず、ユーザーとの対話用に検討材料を提示してください。\n1. 公開情報を調査して前提を整理する。版権キャラクターの不確かな設定は推測で確定しない。\n2. 大まかなStory案を複数提示する。\n3. 各案について画像化しやすさ・展開上の特徴を示す。\n4. ユーザーが決めるべき点や不足情報を質問する。\n\n${storyDiscussionShape}${extra ? `\n\nユーザー追加入力:\n${extra}` : ''}`,
      attachments: [await attachment(ports, 'project_brief.json', brief, '基本設定')],
    };
  if (stage === 'story-finalize' || stage === 'story-fix')
    return {
      stage,
      title: stage === 'story-finalize' ? 'ストーリー完成版' : 'ストーリー修正',
      prompt: `${common}\n\n## Task\n検討は完了しています。これまでの会話でユーザーが確定した事項と添付された基本設定${stage === 'story-fix' ? '・現在の story.md' : ''}を基に、検討案・質問ではなく、画像生成計画へ展開可能な完成版 story.md の全文を納品してください。以前の検討用プロンプトの見出し（調査・前提、Story案、確認事項）で回答してはいけません。章・場面・進行が追える構造にし、Prompt PlanそのものやComfyUI内部情報は書かないでください。出力するのは実際のダウンロード可能な story.md（添付不可なら上記出力契約に従う完全な本文）であり、「作成しました」という完了報告だけではいけません。\n\n${storyShape}${extra ? `\n\n修正意図:\n${extra}` : ''}`,
      attachments: [
        await attachment(ports, 'project_brief.json', brief, '基本設定'),
        ...(stage === 'story-fix'
          ? [await attachment(ports, 'story.md', story, '現在の確定ストーリー')]
          : []),
      ],
    };
  if (stage === 'models' || stage === 'models-fix') {
    const basePath = (await ports.exists(modelsDraft)) ? modelsDraft : models,
      base = await ports.json<any>(basePath),
      family = base?.modelFamily as ModelFamily | undefined;
    return {
      stage,
      title: stage === 'models' ? 'LoRA選定' : 'LoRA再選定',
      prompt: `${common}\n\n## Task\n確定済み story.md と、ユーザーが選択済みの基盤モデルを記録した models.json を前提に、Story上必要なLoRAを選定してください。Checkpoint、Text Encoder、VAE、modelFamily はユーザーの責務であり、変更・再選定・代替提案をしません。trained words、採用理由、用途を考慮してください。\n\n${loraCheckpointPriorityRules(base)}\n\n${loraFallbackDecisionRules}\n\n${dialectRule(family)}\n\n${danbooruTagRules}\n\n${lorasShape}${extra ? `\n\n再選定条件:\n${extra}` : ''}`,
      attachments: [
        await attachment(ports, 'story.md', story, '確定ストーリー'),
        await attachment(ports, 'models.json', basePath, 'ユーザー選択済み基盤モデル（変更禁止）'),
        ...(catalog
          ? [await attachment(ports, 'model_catalog.json', catalog, 'モデルカタログ')]
          : []),
        ...(stage === 'models-fix' && (await ports.exists(promptFallbacks))
          ? [
              await attachment(
                ports,
                'model_prompt_fallbacks.json',
                promptFallbacks,
                '現在のPrompt代替策',
              ),
            ]
          : []),
      ],
    };
  }
  if (stage === 'caption')
    return {
      stage,
      title: 'キャプション本文生成',
      prompt: `${common}\n\n## Task\n確定済みの基本設定・Story・Prompt Planを基に、最終作品のcaption.txtへ使用するタイトルと説明文、およびPixiv投稿用の日本語・英語タイトル（各32文字以内）を作成してください。description の最初の説明文は作品内容に沿った官能的な短いストーリーとし、200文字以内で簡潔にまとめてください。作品内容を要約する短い一覧が有用な場合だけ contents も作成してください。実際の収録画像枚数は手作業で選定・モザイク処理された最終成果物ディレクトリをBatch Studioが数えるため、あなたは枚数を推測・記載しないでください。\n\n${captionShape}${extra ? `\n\n追加条件:\n${extra}` : ''}`,
      attachments: [
        await attachment(ports, 'project_brief.json', brief, '作品・キャラクター・基本設定'),
        await attachment(ports, 'story.md', story, '確定ストーリー'),
        await attachment(ports, 'prompt_plan.json', 'prompt-plan', '実際に画像化するシーン構成'),
      ],
    };
  const briefData = await ports.json<any>(brief),
    modelData = await ports.json<ModelsArtifact>(models);
  const planDraft = 'prompt-plan-draft';
  const currentPlan =
    stage === 'prompt-plan-fix'
      ? (await ports.exists(planDraft))
        ? planDraft
        : 'prompt-plan'
      : null;
  if (stage === 'prompt-plan-fix' && (!currentPlan || !(await ports.exists(currentPlan))))
    throw new Error('修正元のprompt_plan.jsonがありません。先にPrompt Planを生成してください。');
  const planToFix = currentPlan ? await ports.json<PromptPlanArtifact>(currentPlan) : null;
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
      await attachment(ports, 'project_brief.json', brief, '画像枚数などの計画条件'),
      await attachment(ports, 'story.md', story, '確定ストーリー'),
      await attachment(ports, 'models.json', models, '確定モデル・trainedWords（トリガーワード）'),
      ...(currentPlan
        ? [
            await attachment(
              ports,
              'prompt_plan.json',
              currentPlan,
              '現在のPrompt Plan（修正対象）',
            ),
          ]
        : []),
      ...((await ports.exists(promptFallbacks))
        ? [
            await attachment(
              ports,
              'model_prompt_fallbacks.json',
              promptFallbacks,
              'LoRA不足をPromptで解決した代替策',
            ),
          ]
        : []),
    ],
  };
}

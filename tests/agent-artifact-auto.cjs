const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-auto-artifact-'));
execFileSync(
  process.execPath,
  [
    path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc'),
    '-p',
    path.join(repo, 'tsconfig.electron.json'),
    '--outDir',
    runtime,
  ],
  { cwd: repo, stdio: 'inherit' },
);
const source = (name) => fs.readFileSync(path.join(repo, name), 'utf8');
const main = source('src/main/main.ts') + source('src/main/ipc-registration.ts');
const pane = source('src/renderer/CodexPane.tsx');
assert.match(
  main,
  /notification\.method === 'item\/agentMessage\/delta' &&[\s\S]*!codexPendingArtifacts\.has\(threadId as string\)/,
  'Artifact answer deltas must not be forwarded to the renderer',
);
assert.match(main, /codexTaskFileForTurn\(turn\)/);
assert.match(main, /collectCodexArtifact\(threadId, pending, notification\.params\)/);
assert.match(pane, /retryArtifact\(\)/);
assert.match(
  pane,
  /window\.batchStudio\.codex\.sendTask\('prompt-plan-patch', extra\)/,
  'A completed conversational revision must have an explicit route to an artifact task',
);
assert.match(
  pane,
  /通常の「送信」は相談用です/,
  'A normal chat reply must not imply the project draft was changed',
);
const taskBuilder = main.slice(main.indexOf('async function codexSendTask('));
assert.match(
  taskBuilder,
  /prepareCodexFileWorkspace[\s\S]*workspaceOutputInstruction\(workspace\)/,
  'Artifact tasks must stage input files and request a written output file',
);
assert.match(
  main,
  /sandboxPolicy:\s*\{[\s\S]*type: 'workspaceWrite'[\s\S]*writableRoots: \[cwd\]/,
  'Writable Codex turns must be limited to the isolated workspace',
);
assert.match(
  main,
  /readCodexOutput\(pending\.workspace\)/,
  'Codex file output must be read from disk rather than the assistant final message',
);
assert.match(
  main,
  /findCodexWorkspace\([\s\S]*readCodexOutput\(workspace\)/,
  'Retry should restore and read the completed workspace artifact',
);

assert.match(
  source('src/main/grok-auto-artifact-watcher.ts'),
  /MutationObserver|observeGrokArtifact/,
);
assert.match(source('src/renderer/GrokStages.tsx'), /autoArtifact\.armGrok/);

(async () => {
  const { importAutoArtifact, latestAutoArtifact, expectedArtifact, artifactFileContent } =
    await import(pathToFileURL(path.join(runtime, 'main', 'agent-artifact-import.js')).href);
  const { codexTaskFileForTurn, latestCompletedArtifactTurn } = await import(
    pathToFileURL(path.join(runtime, 'main', 'codex-artifact-turn.js')).href
  );
  const { promptPlanPatchBase, applyPromptPlanPatch } = await import(
    pathToFileURL(path.join(runtime, 'main', 'prompt-plan-patch.js')).href
  );
  const {
    prepareCodexFileWorkspace,
    workspaceOutputInstruction,
    rememberCodexWorkspace,
    findCodexWorkspace,
    readCodexOutput,
  } = await import(pathToFileURL(path.join(runtime, 'main', 'codex-file-artifact.js')).href);
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-codex-sandbox-'));
  const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-codex-project-'));
  const prepared = await prepareCodexFileWorkspace(sandboxRoot, 'prompt-plan', [
    { name: 'story.md', content: '# Story' },
    { name: 'models.json', content: '{"schemaVersion":3}' },
  ]);
  assert.ok(prepared.directory.startsWith(sandboxRoot));
  assert.deepEqual(fs.readdirSync(path.join(prepared.directory, 'input')), [
    '1-story.md',
    '2-models.json',
  ]);
  assert.match(workspaceOutputInstruction(prepared), /output\/prompt_plan\.json/);
  assert.match(
    workspaceOutputInstruction(prepared),
    /回答の最後に prompt_plan\.json の生成状況のみ/,
  );
  await assert.rejects(readCodexOutput(prepared), /output\/prompt_plan\.json を生成しませんでした/);
  fs.writeFileSync(prepared.outputPath, '{"schemaVersion":2}');
  assert.equal(await readCodexOutput(prepared), '{"schemaVersion":2}');
  await rememberCodexWorkspace(isolatedRoot, prepared, 'thread-files', 'turn-files');
  const located = await findCodexWorkspace(
    isolatedRoot,
    sandboxRoot,
    'thread-files',
    'turn-files',
    'prompt-plan',
  );
  assert.equal(located?.outputPath, prepared.outputPath);
  assert.equal(
    await findCodexWorkspace(isolatedRoot, sandboxRoot, 'thread-files', 'turn-files', 'caption'),
    null,
  );
  fs.unlinkSync(prepared.outputPath);
  fs.symlinkSync(path.join(prepared.directory, 'input', '2-models.json'), prepared.outputPath);
  await assert.rejects(readCodexOutput(prepared), /通常のファイルではない/);
  fs.unlinkSync(prepared.outputPath);
  console.log('Codex isolated file workspace, safe output read and persisted retry passed.');

  const taskTurn = (fileName) => ({
    status: 'completed',
    items: [
      {
        type: 'userMessage',
        content: [
          {
            text: `## Codex向け出力契約\\n回答の最後に ${fileName} の完成した内容だけを出力してください。`,
          },
        ],
      },
      { type: 'agentMessage', text: '{"schemaVersion":1}' },
    ],
  });
  for (const fileName of [
    'story.md',
    'model_loras.json',
    'prompt_plan.json',
    'prompt_plan_patch.json',
    'caption_content.json',
  ]) {
    assert.equal(codexTaskFileForTurn(taskTurn(fileName)), fileName);
    assert.equal(
      codexTaskFileForTurn({
        status: 'completed',
        items: [
          {
            type: 'userMessage',
            text:
              '## Batch Studio向け成果物出力契約\\n' +
              '作業ディレクトリ内の output/' +
              fileName +
              ' に完成した成果物を直接書き込んでください。',
          },
        ],
      }),
      fileName,
      'Shared CLI workspace contract must remain classifiable from Codex history',
    );
  }
  assert.equal(
    codexTaskFileForTurn({
      items: [
        {
          type: 'userMessage',
          text: '## Codex向け出力契約\\nこれは対話用の検討依頼です。story.mdについて議論します。',
        },
      ],
    }),
    null,
  );
  assert.equal(
    codexTaskFileForTurn({
      items: [{ type: 'userMessage', text: 'caption_content.json を作ってください。' }],
    }),
    null,
  );
  assert.equal(
    codexTaskFileForTurn({
      items: [
        { type: 'userMessage', text: '通常の依頼' },
        { type: 'agentMessage', text: '回答の最後に caption_content.json' },
      ],
    }),
    null,
  );
  const patchTurn = taskTurn('prompt_plan_patch.json');
  assert.equal(
    latestCompletedArtifactTurn(
      [taskTurn('prompt_plan.json'), patchTurn, { status: 'completed', items: [] }],
      ['prompt_plan.json', 'prompt_plan_patch.json'],
    ),
    patchTurn,
    'Retry must select the latest patch task, not an older full Plan task.',
  );
  const captionTurn = taskTurn('caption_content.json');
  const otherTurn = taskTurn('prompt_plan.json');
  assert.equal(
    latestCompletedArtifactTurn(
      [
        captionTurn,
        otherTurn,
        { ...taskTurn('caption_content.json'), status: 'failed' },
        { status: 'completed', items: [] },
      ],
      'caption_content.json',
    ),
    captionTurn,
    'Retry must locate the latest completed task for the current stage even after later chat turns.',
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-auto-artifact-project-'));
  const draft = path.join(root, '._batch_studio', 'drafts', 'story.md');
  assert.equal(expectedArtifact('story-initial'), null);
  assert.equal(expectedArtifact('models'), 'model_loras.json');
  assert.equal(expectedArtifact('caption'), 'caption_content.json');
  assert.equal(expectedArtifact('prompt-plan-patch'), 'prompt_plan_patch.json');
  assert.deepEqual(
    JSON.parse(
      artifactFileContent(
        'models',
        '```json\n{"schemaVersion":1,"loras":[]}\n```',
        JSON.stringify({ schemaVersion: 3, checkpoint: { id: 1 }, loras: [] }),
      ),
    ),
    { schemaVersion: 1, loras: [] },
    'The downloadable LoRA selection must not include merged user base models',
  );

  const raw = '# Story\n\nA complete story.';
  const first = await importAutoArtifact(root, 'codex', 'story-finalize', 'thread-1/turn-1', raw);
  assert.equal(first.phase, 'imported');
  assert.equal(fs.readFileSync(first.filePath, 'utf8'), raw + '\n');
  assert.equal(fs.readFileSync(draft, 'utf8'), raw + '\n');
  const duplicate = await importAutoArtifact(
    root,
    'codex',
    'story-finalize',
    'thread-1/turn-1',
    raw,
  );
  assert.equal(duplicate.phase, 'duplicate');
  const invalid = await importAutoArtifact(root, 'grok', 'story-fix', 'chat-1/code-1', '    ');
  assert.equal(invalid.phase, 'invalid');
  assert.equal(fs.readFileSync(draft, 'utf8'), raw + '\n', 'invalid auto-import must retain draft');
  const promptDraft = path.join(root, '._batch_studio', 'drafts', 'prompt_plan.json');
  fs.writeFileSync(promptDraft, '{"original":"preserve"}\\n');
  const partialPlan = await importAutoArtifact(
    root,
    'codex',
    'prompt-plan-fix',
    'thread-partial/turn-partial',
    '{"id":"b19","prompt":{"triggerWords":[]}}',
  );
  assert.equal(partialPlan.phase, 'invalid', 'A Branch fragment is not a complete Prompt Plan');
  assert.equal(
    fs.readFileSync(promptDraft, 'utf8'),
    '{"original":"preserve"}\\n',
    'An invalid partial revision must not overwrite the current plan draft',
  );

  for (const [source, fragment, expectedError] of [
    ['cut-off', '{"schemaVersion":2,"branches":[{"id":"b19"', '途中で切れている'],
    [
      'explanation',
      'prompt_plan.jsonを修正しました。全文は省略します。',
      'JSONオブジェクトではありません',
    ],
    ['malformed', '{"schemaVersion":2,"branches":,}', 'JSON構文が不正'],
  ]) {
    const result = await importAutoArtifact(
      root,
      'codex',
      'prompt-plan-fix',
      `thread-invalid/${source}`,
      fragment,
    );
    assert.equal(result.phase, 'invalid');
    assert.ok(
      result.issues.some((issue) => issue.message.includes(expectedError)),
      JSON.stringify(result.issues),
    );
    assert.ok(result.rawResponsePath, 'Invalid replies must expose the persisted raw response');
    assert.equal(fs.readFileSync(result.rawResponsePath, 'utf8').trim(), fragment);
    assert.equal(
      fs.readFileSync(promptDraft, 'utf8'),
      '{"original":"preserve"}\\n',
      'Malformed or truncated outputs must never overwrite the existing Prompt Plan',
    );
  }
  assert.match(source('src/renderer/GrokStages.tsx'), /rawResponsePath/);
  assert.match(source('src/renderer/CodexPane.tsx'), /rawResponsePath/);

  const largeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-plan-patch-'));
  let nextLeaf = 0;
  const plan = {
    schemaVersion: 2,
    triggerWordsMode: 'selected',
    common: { positive: { camera: { pov: ['pov'] } }, negative: {}, triggerWords: [] },
    rootLoras: [],
    branches: Array.from({ length: 19 }, (_, i) => ({
      id: 'b' + String(i + 1).padStart(2, '0'),
      label: 'Branch ' + (i + 1),
      loras: [],
      prompt: {
        triggerWords: i === 18 ? [{ modelRef: 'lora.foo', words: ['pov'] }] : [],
        positive: { camera: { pov: [] } },
        negative: {},
      },
      leaves: Array.from({ length: i === 18 ? 32 : 26 }, () => {
        nextLeaf++;
        return {
          id: 's' + String(nextLeaf).padStart(3, '0'),
          name: 'Scene ' + nextLeaf,
          prompt: { positive: { expression: ['neutral'] }, negative: {} },
        };
      }),
    })),
  };
  assert.equal(nextLeaf, 500);
  const confirmedPlanPath = path.join(largeRoot, 'prompt_plan.json');
  const originalPlanText = JSON.stringify(plan, null, 2) + '\n';
  fs.writeFileSync(confirmedPlanPath, originalPlanText);
  const base = await promptPlanPatchBase(largeRoot);
  assert.equal(base.branches, 19);
  assert.equal(base.leaves, 500);
  assert.equal(base.filePath, confirmedPlanPath);
  const operation = {
    scope: 'branch',
    branchId: 'b19',
    path: 'prompt.triggerWords',
    before: [{ modelRef: 'lora.foo', words: ['pov'] }],
    after: [{ modelRef: 'lora.foo', words: [] }],
  };
  const patch = (hash, operations) =>
    JSON.stringify({ schemaVersion: 1, baseSha256: hash, operations });
  const candidate = patch(base.baseSha256, [operation]);
  const patchResult = await importAutoArtifact(
    largeRoot,
    'codex',
    'prompt-plan-patch',
    'thread-patch/turn-patch',
    candidate,
  );
  assert.equal(patchResult.phase, 'imported', JSON.stringify(patchResult));
  assert.equal(path.basename(patchResult.filePath), 'prompt_plan_patch.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(patchResult.filePath, 'utf8')).operations, [
    operation,
  ]);
  const patchedDraftPath = path.join(largeRoot, '._batch_studio', 'drafts', 'prompt_plan.json');
  const patchedText = fs.readFileSync(patchedDraftPath, 'utf8');
  const patched = JSON.parse(patchedText);
  assert.equal(patched.branches.length, 19);
  assert.equal(
    patched.branches.reduce((total, b) => total + b.leaves.length, 0),
    500,
  );
  assert.deepEqual(patched.branches[18].prompt.triggerWords, operation.after);
  assert.deepEqual(patched.branches[0], plan.branches[0], 'Untouched Branches must be identical');
  assert.deepEqual(patched.branches[18].leaves, plan.branches[18].leaves);
  assert.equal(
    fs.readFileSync(confirmedPlanPath, 'utf8'),
    originalPlanText,
    'Partial revision must only update the draft, never the confirmed Plan',
  );
  const sameTurn = await importAutoArtifact(
    largeRoot,
    'codex',
    'prompt-plan-patch',
    'thread-patch/turn-patch',
    candidate,
  );
  assert.equal(sameTurn.phase, 'duplicate', 'Completed patch imports must be idempotent');
  const stale = await applyPromptPlanPatch(largeRoot, candidate);
  assert.equal(stale.validation.valid, false);
  assert.equal(stale.validation.issues[0].code, 'PATCH_BASE_CHANGED');
  const nextBase = await promptPlanPatchBase(largeRoot);
  const invalidCases = [
    { operation: { ...operation, before: operation.before }, code: 'PATCH_EXPECTED_MISMATCH' },
    { operation: { ...operation, path: 'rootLoras' }, code: 'PATCH_OPERATION' },
    { operation: { ...operation, branchId: 'b99' }, code: 'PATCH_TARGET' },
    {
      operation: {
        ...operation,
        path: 'prompt.positive.camera.pov',
        before: [],
        after: ['bad,tag'],
      },
      code: 'PROMPT_TAG_FORMAT',
    },
  ];
  for (const { operation: proposed, code } of invalidCases) {
    const result = await applyPromptPlanPatch(largeRoot, patch(nextBase.baseSha256, [proposed]));
    assert.equal(result.validation.valid, false, code);
    assert.ok(
      result.validation.issues.some((issue) => issue.code === code),
      JSON.stringify(result),
    );
    assert.equal(fs.readFileSync(patchedDraftPath, 'utf8'), patchedText);
  }
  const duplicateOperations = await applyPromptPlanPatch(
    largeRoot,
    patch(nextBase.baseSha256, [
      { ...operation, before: operation.after },
      { ...operation, before: operation.after },
    ]),
  );
  assert.equal(duplicateOperations.validation.issues[0].code, 'PATCH_DUPLICATE');
  assert.equal(fs.readFileSync(patchedDraftPath, 'utf8'), patchedText);
  const fragment = await applyPromptPlanPatch(
    largeRoot,
    '{"id":"b19","prompt":{"triggerWords":[]}}',
  );
  assert.equal(fragment.validation.issues[0].code, 'PATCH_FORMAT');
  assert.equal(fs.readFileSync(patchedDraftPath, 'utf8'), patchedText);
  console.log('500-leaf Prompt Plan patch validation, stale hash, atomicity and retry passed.');

  const recovered = await latestAutoArtifact(root, 'codex', 'story-finalize', 'thread-1/');
  assert.equal(recovered.filePath, first.filePath);

  const caption = JSON.stringify({
    schemaVersion: 1,
    title: { ja: '作品', en: 'Work' },
    description: { ja: ['短い説明'], en: ['Short description'] },
  });
  const captionFirst = await importAutoArtifact(root, 'grok', 'caption', 'chat-2/file-1', caption);
  assert.equal(captionFirst.phase, 'imported');
  const captionDraft = path.join(root, '._batch_studio', 'drafts', 'caption_content.json');
  const original = fs.readFileSync(captionDraft, 'utf8');
  const invalidCaption = await importAutoArtifact(
    root,
    'codex',
    'caption',
    'thread-2/turn-1',
    JSON.stringify({ schemaVersion: 1, title: { ja: 'missing en' } }),
  );
  assert.equal(invalidCaption.phase, 'invalid');
  assert.equal(fs.readFileSync(captionDraft, 'utf8'), original);
  console.log(
    'Shared Grok/Codex artifact auto-import, file output, deduplication and draft preservation passed.',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

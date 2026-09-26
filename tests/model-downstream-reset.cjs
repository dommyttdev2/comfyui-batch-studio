const assert = require('node:assert/strict');
const { matchCode, doesNotMatchCode } = require('./source-match.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-downstream-reset-runtime-'));
const tscBin = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
const appUi = fs.readFileSync(path.join(repo, 'src/renderer/App.tsx'), 'utf8');
const grokUi = fs.readFileSync(path.join(repo, 'src/renderer/GrokStages.tsx'), 'utf8');
const menuUi = fs.readFileSync(path.join(repo, 'src/renderer/StageResetMenu.tsx'), 'utf8');
const preload = fs.readFileSync(path.join(repo, 'src/preload/index.cjs'), 'utf8');
const mainSource = fs.readFileSync(path.join(repo, 'src/main/main.ts'), 'utf8');
matchCode(
  appUi,
  /stageResetScope\(stage:Stage\)/,
  'top-level stages must expose reset scope mapping',
);
matchCode(
  appUi,
  /<StageResetMenu scope=\{resetScope\}/,
  'stage header must expose the kebab reset menu',
);
matchCode(grokUi, /scope="base-models"/, 'base model selection must expose its own reset menu');
matchCode(
  grokUi,
  /resetScope=\{hasInitialSelection\?'models':undefined\}/,
  'initial Grok LoRA selection must expose reset only after a selection exists',
);
matchCode(grokUi, /resetScope="models-fix"/, 'LoRA reselection must expose its own reset menu');
matchCode(
  grokUi,
  /history\.some\(x=>x\.stage==='models'\)/,
  'reselection must depend on actual initial Grok selection history',
);
matchCode(menuUi, /︙/);
matchCode(menuUi, /この工程からリセット/);
matchCode(menuUi, /保持されます/);
matchCode(menuUi, /リセットされます/);
matchCode(
  menuUi,
  /if\(busyRef\.current\)return/,
  'busy Escape/cancel must not dismiss an active reset',
);
matchCode(menuUi, /if\(busy\)return/, 'double-click reset submission must remain single-flight');
matchCode(
  menuUi,
  /setConfirming\(false\)[\s\S]*restoreTriggerFocus\(\)/,
  'successful or cancelled reset must restore focus to the originating trigger',
);
doesNotMatchCode(
  menuUi,
  /window\.(?:confirm|prompt)/,
  'reset confirmation must use the app modal, not unsupported browser dialogs',
);
matchCode(
  preload,
  /resetFrom:\(r,s\)=>ipcRenderer\.invoke\(I\.ARTIFACT_RESET_FROM,r,s\)/,
  'preload must expose manual reset API',
);
matchCode(
  mainSource,
  /manualResetFrom\(root,scope\)/,
  'main process must invoke the shared reset implementation',
);
execFileSync(
  process.execPath,
  [tscBin, '-p', path.join(repo, 'tsconfig.electron.json'), '--outDir', runtime],
  { cwd: repo, stdio: 'inherit' },
);
const load = (relative) => import(pathToFileURL(path.join(runtime, relative)).href);
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
};
const write = (p, v = 'x') => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, v);
};
const exists = (p) => fs.existsSync(p);
const catalogMeta = (generation = 3) => ({
  schemaVersion: 1,
  generation,
  generatedAt: `2026-09-09T0${generation}:00:00Z`,
});
const file = (id, name) => ({ id, name, type: 'Model' });
const catalogItem = (
  modelId,
  modelName,
  modelType,
  versionId,
  fileId,
  fileName,
  trainedWords = [],
) => ({
  modelId,
  modelName,
  modelType,
  versionId,
  versionName: 'v1',
  baseModel: 'Illustrious',
  files: [file(fileId, fileName)],
  trainedWords,
  versions: [
    {
      versionId,
      versionName: 'v1',
      baseModel: 'Illustrious',
      files: [file(fileId, fileName)],
      trainedWords,
    },
  ],
});
const selection = (ref, modelId, modelName, versionId, fileId, fileName, trainedWords = []) => ({
  ref,
  modelId,
  modelName,
  versionId,
  versionName: 'v1',
  fileId,
  fileName,
  modelUrl: `https://civitai.com/models/${modelId}`,
  trainedWords,
  reason: 'selected',
});
const models = (generation = 3, loraModelId = 2, loraWords = ['pose_a']) => ({
  schemaVersion: 4,
  modelFamily: 'illustrious',
  catalog: catalogMeta(generation),
  checkpoint: selection('checkpoint.main', 1, 'Checkpoint', 11, 111, 'checkpoint.safetensors', [
    'style',
  ]),
  loras: [
    selection(
      `lora.pose_${loraModelId}`,
      loraModelId,
      `LoRA ${loraModelId}`,
      loraModelId * 10 + 1,
      loraModelId * 100 + 1,
      `lora-${loraModelId}.safetensors`,
      loraWords,
    ),
  ],
});
const catalog = {
  ...catalogMeta(3),
  collections: [
    {
      id: 1,
      name: 'Tests',
      items: [
        catalogItem(1, 'Checkpoint', 'Checkpoint', 11, 111, 'checkpoint.safetensors', ['style']),
        catalogItem(2, 'LoRA 2', 'LORA', 21, 201, 'lora-2.safetensors', ['pose_a']),
        catalogItem(3, 'LoRA 3', 'LORA', 31, 301, 'lora-3.safetensors', ['pose_b']),
      ],
    },
  ],
};
function downstream(root) {
  write(path.join(root, 'prompt_plan.json'), '{}\n');
  write(path.join(root, '._batch_studio', 'drafts', 'prompt_plan.json'), '{}\n');
  write(path.join(root, '._batch_studio', 'grok-responses', 'prompt-plan', 'one.txt'), 'prompt');
  write(
    path.join(root, '._batch_studio', 'grok-responses', 'prompt-plan-fix', 'one.txt'),
    'prompt-fix',
  );
  write(path.join(root, '._batch_studio', 'grok-responses', 'models-fix', 'one.txt'), 'models-fix');
  write(path.join(root, '._batch_studio', 'grok-responses', 'models', 'old.txt'), 'models');
  write(path.join(root, 'LoRA_project.json'), 'workflow');
  writeJson(path.join(root, 'project_meta.json'), {
    schemaVersion: 1,
    createdAt: '2026-09-09T00:00:00Z',
    settings: { executionTarget: 'local' },
    workflowBuild: { outputPath: 'LoRA_project.json', generatedAt: '2026-09-09T01:00:00Z' },
  });
}
function story(root) {
  write(path.join(root, 'story.md'), 'story');
  write(
    path.join(root, '._batch_studio', 'grok-responses', 'story-finalize', 'one.txt'),
    'story response',
  );
}
function initialPayload(
  lora = selection('lora.pose_2', 2, 'LoRA 2', 21, 201, 'lora-2.safetensors', ['pose_a']),
  fallbackTag = 'initial_tag',
) {
  return {
    schemaVersion: 1,
    loras: [lora],
    promptFallbacks: [
      { requirement: 'camera', positiveTags: [fallbackTag], negativeTags: [], reason: 'initial' },
    ],
  };
}
function prepareManual(root, current = models(3, 3)) {
  story(root);
  writeJson(path.join(root, 'models.json'), current);
  downstream(root);
  writeJson(path.join(root, 'models.json'), current);
  write(
    path.join(root, '._batch_studio', 'grok-responses', 'models', 'initial.txt'),
    JSON.stringify(initialPayload()),
  );
  writeJson(path.join(root, '._batch_studio', 'model_prompt_fallbacks.json'), {
    schemaVersion: 1,
    promptFallbacks: [
      {
        requirement: 'camera',
        positiveTags: ['current_tag'],
        negativeTags: [],
        reason: 'current',
      },
    ],
  });
}
function archiveEntries(root) {
  const dir = path.join(root, '._batch_studio', 'history', 'downstream-reset');
  return exists(dir) ? fs.readdirSync(dir) : [];
}
(async () => {
  const [
    { modelGenerationInputsChanged, resetModelDownstream, manualResetFrom },
    { importGrok, confirmArtifact, saveDraft },
    transaction,
  ] = await Promise.all([
    load('main/model-downstream-reset.js'),
    load('main/artifact-service.js'),
    load('main/project-transaction.js'),
  ]);
  const a = models(2, 2),
    catalogOnly = {
      ...a,
      catalog: catalogMeta(3),
      checkpoint: {
        ...a.checkpoint,
        reason: 'different explanation',
        modelName: 'renamed for display',
      },
      loras: a.loras.map((x) => ({ ...x, reason: 'new reason', modelName: 'display rename' })),
    };
  assert.equal(
    modelGenerationInputsChanged(a, [], catalogOnly, []),
    false,
    'catalog provenance and descriptive metadata must not reset downstream',
  );
  assert.equal(
    modelGenerationInputsChanged(a, [], models(2, 2, ['pose_changed']), []),
    true,
    'trainedWords affect prompt generation',
  );
  assert.equal(
    modelGenerationInputsChanged(
      a,
      [{ requirement: 'pose', positiveTags: ['tag_a'], negativeTags: [], reason: 'old' }],
      a,
      [{ requirement: 'pose', positiveTags: ['tag_b'], negativeTags: [], reason: 'new' }],
    ),
    true,
    'prompt fallback content affects prompt generation',
  );
  assert.equal(
    modelGenerationInputsChanged(
      a,
      [{ requirement: 'pose', positiveTags: ['tag_a'], negativeTags: [], reason: 'old' }],
      a,
      [
        {
          requirement: 'pose',
          positiveTags: ['tag_a'],
          negativeTags: [],
          reason: 'new reason only',
        },
      ],
    ),
    false,
    'fallback reason alone must not reset downstream',
  );

  const directRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-reset-direct-'));
  downstream(directRoot);
  await resetModelDownstream(directRoot, { clearModelFixHistory: false });
  assert.equal(exists(path.join(directRoot, 'prompt_plan.json')), false);
  assert.equal(
    exists(path.join(directRoot, '._batch_studio', 'drafts', 'prompt_plan.json')),
    false,
  );
  assert.equal(
    exists(path.join(directRoot, '._batch_studio', 'grok-responses', 'prompt-plan')),
    false,
  );
  assert.equal(
    exists(path.join(directRoot, '._batch_studio', 'grok-responses', 'prompt-plan-fix')),
    false,
  );
  assert.equal(
    exists(path.join(directRoot, '._batch_studio', 'grok-responses', 'models-fix')),
    true,
    'reselection confirmation keeps its own history',
  );
  assert.equal(exists(path.join(directRoot, 'LoRA_project.json')), false);
  const directMeta = JSON.parse(
    fs.readFileSync(path.join(directRoot, 'project_meta.json'), 'utf8'),
  );
  assert.equal(directMeta.workflowBuild, undefined);
  assert.equal(directMeta.settings.executionTarget, 'local');
  const archives = archiveEntries(directRoot);
  assert.equal(archives.length, 1);
  assert.equal(
    exists(
      path.join(
        directRoot,
        '._batch_studio',
        'history',
        'downstream-reset',
        archives[0],
        'prompt_plan.json',
      ),
    ),
    true,
    'reset data must be recoverable from hidden history',
  );

  const manualWorkflow = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-reset-workflow-'));
  prepareManual(manualWorkflow);
  await manualResetFrom(manualWorkflow, 'workflow');
  assert.equal(exists(path.join(manualWorkflow, 'LoRA_project.json')), false);
  assert.equal(
    exists(path.join(manualWorkflow, 'prompt_plan.json')),
    true,
    'workflow reset must preserve prompt plan',
  );
  assert.equal(exists(path.join(manualWorkflow, 'models.json')), true);
  const manualPlan = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-reset-plan-'));
  prepareManual(manualPlan);
  await manualResetFrom(manualPlan, 'prompt-plan');
  assert.equal(exists(path.join(manualPlan, 'prompt_plan.json')), false);
  assert.equal(exists(path.join(manualPlan, 'LoRA_project.json')), false);
  assert.equal(
    exists(path.join(manualPlan, 'models.json')),
    true,
    'prompt plan reset must preserve model selection',
  );
  const manualModels = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-reset-models-'));
  prepareManual(manualModels);
  await manualResetFrom(manualModels, 'models');
  const baseOnly = JSON.parse(fs.readFileSync(path.join(manualModels, 'models.json'), 'utf8'));
  assert.deepEqual(
    baseOnly.loras,
    [],
    'initial LoRA reset must preserve base model but clear LoRAs',
  );
  assert.equal(baseOnly.checkpoint.fileName, 'checkpoint.safetensors');
  assert.equal(exists(path.join(manualModels, 'story.md')), true);
  assert.equal(
    exists(path.join(manualModels, '._batch_studio', 'grok-responses', 'models')),
    false,
  );
  assert.equal(
    exists(path.join(manualModels, '._batch_studio', 'grok-responses', 'models-fix')),
    false,
  );
  assert.equal(exists(path.join(manualModels, 'prompt_plan.json')), false);
  const manualFix = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-reset-fix-'));
  prepareManual(manualFix);
  await manualResetFrom(manualFix, 'models-fix');
  const restored = JSON.parse(fs.readFileSync(path.join(manualFix, 'models.json'), 'utf8'));
  assert.equal(
    restored.loras[0].modelId,
    2,
    'reselection reset must restore latest initial selection',
  );
  assert.equal(
    exists(path.join(manualFix, '._batch_studio', 'grok-responses', 'models')),
    true,
    'initial history must remain when only reselection is reset',
  );
  assert.equal(
    exists(path.join(manualFix, '._batch_studio', 'grok-responses', 'models-fix')),
    false,
  );
  const restoredFallback = JSON.parse(
    fs.readFileSync(path.join(manualFix, '._batch_studio', 'model_prompt_fallbacks.json'), 'utf8'),
  );
  assert.deepEqual(restoredFallback.promptFallbacks[0].positiveTags, ['initial_tag']);
  assert.equal(exists(path.join(manualFix, 'prompt_plan.json')), false);
  const manualBase = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-reset-base-'));
  prepareManual(manualBase);
  await manualResetFrom(manualBase, 'base-models');
  assert.equal(
    exists(path.join(manualBase, 'story.md')),
    true,
    'base model reset must preserve story',
  );
  assert.equal(exists(path.join(manualBase, 'models.json')), false);
  assert.equal(exists(path.join(manualBase, 'prompt_plan.json')), false);
  const manualStory = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-reset-story-'));
  prepareManual(manualStory);
  await manualResetFrom(manualStory, 'story');
  assert.equal(exists(path.join(manualStory, 'story.md')), false);
  assert.equal(exists(path.join(manualStory, 'models.json')), false);
  assert.equal(exists(path.join(manualStory, 'prompt_plan.json')), false);
  assert.equal(exists(path.join(manualStory, 'LoRA_project.json')), false);
  assert.ok(archiveEntries(manualStory).length >= 1, 'manual reset must archive reset data');

  const catalogPath = path.join(
    os.tmpdir(),
    `batch-studio-catalog-${process.pid}-${Date.now()}.json`,
  );
  writeJson(catalogPath, catalog);
  process.env.BATCH_STUDIO_CATALOG_PATH = catalogPath;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-reset-confirm-'));
  writeJson(path.join(root, 'models.json'), models(3, 2));
  downstream(root);
  writeJson(path.join(root, 'models.json'), models(3, 2));
  const lora3 = selection('lora.pose_3', 3, 'LoRA 3', 31, 301, 'lora-3.safetensors', ['pose_b']);
  const imported = await importGrok(
    root,
    'models',
    JSON.stringify({
      schemaVersion: 1,
      loras: [lora3],
      promptFallbacks: [
        {
          requirement: 'camera angle',
          positiveTags: ['from_below'],
          negativeTags: [],
          reason: 'prompt is sufficient',
        },
      ],
    }),
    'models',
  );
  assert.equal(imported.validation.valid, true);
  const result = await confirmArtifact(root, 'models');
  assert.equal(
    result.downstreamReset,
    true,
    'reconfirming selection 1 with effective changes must reset downstream',
  );
  assert.equal(exists(path.join(root, 'prompt_plan.json')), false);
  assert.equal(
    exists(path.join(root, '._batch_studio', 'grok-responses', 'models-fix')),
    false,
    'selection 1 reconfirmation clears old reselection history',
  );
  assert.equal(
    exists(path.join(root, '._batch_studio', 'grok-responses', 'models')),
    true,
    'selection 1 history must remain',
  );
  assert.equal(exists(path.join(root, 'LoRA_project.json')), false);
  const confirmed = JSON.parse(fs.readFileSync(path.join(root, 'models.json'), 'utf8'));
  assert.equal(confirmed.loras[0].modelId, 3);
  const fallback = JSON.parse(
    fs.readFileSync(path.join(root, '._batch_studio', 'model_prompt_fallbacks.json'), 'utf8'),
  );
  assert.equal(
    fallback.promptFallbacks[0].positiveTags[0],
    'from_below',
    'new fallback must survive downstream reset',
  );

  const provenanceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-reset-provenance-'));
  writeJson(path.join(provenanceRoot, 'models.json'), models(2, 2));
  downstream(provenanceRoot);
  writeJson(path.join(provenanceRoot, 'models.json'), models(2, 2));
  await saveDraft(provenanceRoot, 'models', JSON.stringify(models(2, 2), null, 2));
  const provenanceResult = await confirmArtifact(provenanceRoot, 'models');
  assert.equal(
    provenanceResult.downstreamReset,
    false,
    'catalog generation refresh alone must not reset downstream',
  );
  assert.equal(exists(path.join(provenanceRoot, 'prompt_plan.json')), true);
  assert.equal(exists(path.join(provenanceRoot, 'LoRA_project.json')), true);
  const provenanceConfirmed = JSON.parse(
    fs.readFileSync(path.join(provenanceRoot, 'models.json'), 'utf8'),
  );
  assert.equal(
    provenanceConfirmed.catalog.generation,
    3,
    'PR #28 provenance refresh must still be preserved',
  );
  // An ordinary filesystem exception must restore the exact previous
  // generation, including drafts, meta and fallback selections.
  const preserved = (root) => {
    const paths = [
      'story.md',
      'models.json',
      'prompt_plan.json',
      'LoRA_project.json',
      'project_meta.json',
      '._batch_studio/drafts/models.json',
      '._batch_studio/drafts/prompt_plan.json',
      '._batch_studio/model_prompt_fallbacks.json',
      '._batch_studio/grok-responses/models-fix/one.txt',
    ];
    return Object.fromEntries(
      paths.map((file) => {
        const target = path.join(root, file);
        return [file, exists(target) ? fs.readFileSync(target, 'utf8') : null];
      }),
    );
  };
  const assertPreserved = (root, old, scope) => {
    assert.deepEqual(
      preserved(root),
      old,
      scope + ' may not leave mixed model/plan/workflow generations',
    );
    assert.equal(
      exists(path.join(root, '._batch_studio', 'project-transaction.json')),
      false,
      scope + ' must release the journal after successful recovery',
    );
  };
  for (const scope of ['workflow', 'prompt-plan', 'models-fix', 'models', 'base-models', 'story']) {
    const failureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-reset-failure-'));
    prepareManual(failureRoot);
    const before = preserved(failureRoot);
    const localImage = path.join(failureRoot, 'output', 'existing.png');
    write(localImage, 'existing-local-artifact');
    transaction.setProjectTransactionCheckpointForTests((step) => {
      if (step.startsWith('archived:'))
        throw Object.assign(new Error('Injected EACCES'), { code: 'EACCES' });
    });
    try {
      await assert.rejects(() => manualResetFrom(failureRoot, scope), /Injected EACCES/);
      assertPreserved(failureRoot, before, scope);
      assert.equal(fs.readFileSync(localImage, 'utf8'), 'existing-local-artifact');
    } finally {
      transaction.setProjectTransactionCheckpointForTests(null);
    }
    await manualResetFrom(failureRoot, scope);
  }
  {
    const confirmRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-confirm-failure-'));
    writeJson(path.join(confirmRoot, 'models.json'), models(3, 2));
    downstream(confirmRoot);
    writeJson(path.join(confirmRoot, 'models.json'), models(3, 2));
    const imported = await importGrok(
      confirmRoot,
      'models',
      JSON.stringify({
        schemaVersion: 1,
        loras: [lora3],
        promptFallbacks: [
          {
            requirement: 'camera angle',
            positiveTags: ['from_below'],
            negativeTags: [],
            reason: 'test',
          },
        ],
      }),
      'models',
    );
    assert.equal(imported.validation.valid, true);
    const before = preserved(confirmRoot);
    for (const stage of [
      'models:confirmed',
      'models:fallbacks-updated',
      'archived:prompt_plan.json',
    ]) {
      let hit = false;
      transaction.setProjectTransactionCheckpointForTests((step) => {
        if (!hit && step === stage) {
          hit = true;
          throw Object.assign(new Error('Injected ENOSPC at ' + step), { code: 'ENOSPC' });
        }
      });
      try {
        await assert.rejects(() => confirmArtifact(confirmRoot, 'models'), /Injected ENOSPC/);
        assert.equal(hit, true);
        assertPreserved(confirmRoot, before, 'model confirm ' + stage);
      } finally {
        transaction.setProjectTransactionCheckpointForTests(null);
      }
    }
    // Simulate process termination after a rename. On the next project open
    // recover from the durable journal before exposing partially moved files.
    transaction.setProjectTransactionCheckpointForTests((step) => {
      if (step === 'archived:prompt_plan.json')
        throw new transaction.SimulatedProjectCrashForTest('Injected power loss');
    });
    try {
      await assert.rejects(() => confirmArtifact(confirmRoot, 'models'), /Injected power loss/);
    } finally {
      transaction.setProjectTransactionCheckpointForTests(null);
    }
    assert.equal(
      exists(path.join(confirmRoot, '._batch_studio', 'project-transaction.json')),
      true,
    );
    assert.notDeepEqual(
      preserved(confirmRoot),
      before,
      'crash should leave a partially applied transaction',
    );
    await transaction.recoverPendingProjectTransaction(confirmRoot);
    assertPreserved(confirmRoot, before, 'crash recovery');
    const confirmedAgain = await confirmArtifact(confirmRoot, 'models');
    assert.equal(confirmedAgain.downstreamReset, true);
    assert.equal(exists(path.join(confirmRoot, 'prompt_plan.json')), false);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(confirmRoot, 'models.json'), 'utf8')).loras[0].modelId,
      3,
    );
  }

  console.log('Model downstream reset and manual stage reset tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import type { AgentWorkspace } from './agent-runtime-types.js';
export function agentWorkspaceOutputInstruction(workspace: AgentWorkspace): string {
  return [
    '## Batch Studio向け成果物出力契約',
    `回答では ${workspace.fileName} の生成状況だけを短く報告し、JSONやMarkdown全文は会話へ再掲しないでください。`,
    `作業ディレクトリ内の output/${workspace.fileName} に完成した成果物を直接書き込んでください。`,
    'input/ 内の参照ファイルは読み取り専用として扱い、変更しないでください。',
    'input/ や output/ 以外、プロジェクト本体、既存下書き、確定版ファイルを変更しないでください。',
    '既存成果物がinput/にある場合は修正元として参照し、完成版をoutput/へ別ファイルで保存してください。',
    'ファイルを書き終える前に完了と報告しないでください。書き込めない場合は理由を報告してください。',
    'Batch Studioがoutput/を読み込み、Schemaと内容を検証した場合だけ下書きへ反映します。',
  ].join('\n');
}

import { useState } from 'react';
import type { GrokContextStage, ProjectSummary, ValidationIssue } from '../shared/types';

export type Stage =
  | '概要'
  | '基本設定'
  | 'ストーリー'
  | 'モデル選定'
  | 'プロンプト設計'
  | 'ワークフロー'
  | 'モデル配置'
  | '実行前チェック'
  | '実行'
  | '最終成果物'
  | 'キャプション'
  | 'サムネイル'
  | '販売サイト用画像';
export type Runner = <T>(fn: () => Promise<T>) => Promise<T | undefined>;
export const stages: Stage[] = [
  '概要',
  '基本設定',
  'ストーリー',
  'モデル選定',
  'プロンプト設計',
  'ワークフロー',
  'モデル配置',
  '実行前チェック',
  '実行',
  '最終成果物',
  'キャプション',
  'サムネイル',
  '販売サイト用画像',
];
const GROK_STAGE_CONTEXT: Partial<Record<Stage, GrokContextStage>> = {
  ストーリー: 'story',
  モデル選定: 'models',
  プロンプト設計: 'prompt-plan',
  キャプション: 'caption',
};
export function shouldShowGrok(stage: Stage) {
  return Boolean(GROK_STAGE_CONTEXT[stage]);
}
export function grokContextStage(stage: Stage) {
  return GROK_STAGE_CONTEXT[stage] ?? null;
}
function formatValidationIssue(i: ValidationIssue) {
  const icon = i.severity === 'error' ? '✕' : i.severity === 'warning' ? '⚠' : 'ℹ';
  return `${icon} ${i.location ? `[${i.location}] ` : ''}${i.message}`;
}
async function writeClipboardText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall through to the DOM copy path. This is useful when clipboard access
    // is restricted by the current Electron renderer context.
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Clipboard copy failed');
}
function WarningCopyButton({ warnings }: { warnings: ValidationIssue[] }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copyWarnings = async () => {
    try {
      await writeClipboardText(warnings.map(formatValidationIssue).join('\n'));
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    window.setTimeout(() => setCopyState('idle'), 1600);
  };
  return (
    <button type="button" onClick={() => void copyWarnings()}>
      {copyState === 'copied'
        ? 'コピーしました'
        : copyState === 'failed'
          ? 'コピーに失敗しました'
          : `Warningを一括コピー (${warnings.length})`}
    </button>
  );
}
function IssuesView({ issues }: { issues: ValidationIssue[] }) {
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  return (
    <div className="issues">
      {warnings.length > 0 && (
        <div className="actions">
          <WarningCopyButton warnings={warnings} />
        </div>
      )}
      {issues.map((i, n) => (
        <div key={n} className={`issue ${i.severity}`}>
          {formatValidationIssue(i)}
        </div>
      ))}
    </div>
  );
}
export function issuesView(issues: ValidationIssue[]) {
  if (!issues.length) return <div className="ok">✓ 問題ありません</div>;
  return <IssuesView issues={issues} />;
}
export function badge(s: string) {
  return (
    <span className={`badge ${s}`}>
      {(
        {
          missing: '未作成',
          draft: '下書き',
          invalid: '要修正',
          warning: '注意あり',
          confirmed: '確定済み',
          generated: '生成済み',
          legacy: '旧形式',
          stale: '更新必要',
        } as Record<string, string>
      )[s] ?? s}
    </span>
  );
}
export function statusDot(p: ProjectSummary, s: Stage) {
  const map: Partial<Record<Stage, string>> = {
    基本設定: 'projectBrief',
    ストーリー: 'story',
    モデル選定: 'models',
    プロンプト設計: 'promptPlan',
    ワークフロー: 'workflow',
  };
  const a = p.artifacts.find((x) => x.key === map[s]);
  return a ? <span className={`dot ${a.state}`} /> : null;
}

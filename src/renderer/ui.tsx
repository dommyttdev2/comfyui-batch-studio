import type { ProjectSummary, ValidationIssue } from '../shared/types';

export type Stage='概要'|'基本設定'|'ストーリー'|'モデルカタログ'|'モデル選定'|'プロンプト設計'|'ワークフロー'|'モデル配置'|'実行前チェック';
export type Runner=<T>(fn:()=>Promise<T>)=>Promise<T|undefined>;
export const stages:Stage[]=['概要','基本設定','ストーリー','モデルカタログ','モデル選定','プロンプト設計','ワークフロー','モデル配置','実行前チェック'];
const GROK_STAGES:ReadonlySet<Stage>=new Set(['ストーリー','モデル選定','プロンプト設計']);
export function shouldShowGrok(stage:Stage){return GROK_STAGES.has(stage)}
export function issuesView(issues:ValidationIssue[]){if(!issues.length)return <div className="ok">✓ 問題ありません</div>;return <div className="issues">{issues.map((i,n)=><div key={n} className={`issue ${i.severity}`}>{i.severity==='error'?'✕':i.severity==='warning'?'⚠':'ℹ'} {i.message}</div>)}</div>}
export function badge(s:string){return <span className={`badge ${s}`}>{({missing:'未作成',draft:'下書き',invalid:'要修正',warning:'注意あり',confirmed:'確定済み',generated:'生成済み',legacy:'旧形式',stale:'更新必要'} as Record<string,string>)[s]??s}</span>}
export function statusDot(p:ProjectSummary,s:Stage){const map:Partial<Record<Stage,string>>={'基本設定':'projectBrief','ストーリー':'story','モデル選定':'models','プロンプト設計':'promptPlan','ワークフロー':'workflow'};const a=p.artifacts.find(x=>x.key===map[s]);return a?<span className={`dot ${a.state}`}/>:null}

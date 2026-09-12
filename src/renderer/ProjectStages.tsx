import { useEffect, useState } from 'react';
import type { ProjectBriefInput, ProjectSummary } from '../shared/types';
import type { Runner } from './ui';
import { badge } from './ui';

export function Overview({ project }: { project: ProjectSummary }) {
  const done = project.artifacts.filter((a) =>
    ['confirmed', 'generated', 'warning'].includes(a.state),
  ).length;
  return (
    <>
      <section className="next">
        <span className="eyebrow">次にすること</span>
        <h3>
          {project.artifacts.find(
            (a) => !['confirmed', 'generated', 'warning', 'legacy'].includes(a.state),
          )?.label ?? '実行前チェックを確認してください'}
        </h3>
        <p>{done}工程が完了しています。</p>
      </section>
      <div className="cards">
        {project.artifacts
          .filter((a) => a.key !== 'legacyPromptTree')
          .map((a) => (
            <article key={a.key}>
              <h3>{a.label}</h3>
              {badge(a.state)}
              <small>{a.relativePath ?? '未作成'}</small>
            </article>
          ))}
      </div>
    </>
  );
}
export function Settings({
  project,
  setProject,
  run,
}: {
  project: ProjectSummary;
  setProject: (p: ProjectSummary) => void;
  run: Runner;
}) {
  const [brief, setBrief] = useState<ProjectBriefInput | null>(null);
  useEffect(() => {
    void run(async () => {
      const r = await window.batchStudio.artifact.read(
        project.rootPath,
        'projectBrief',
        'confirmed',
      );
      if (r.content) {
        const p = JSON.parse(r.content);
        delete p.schemaVersion;
        setBrief(p);
      }
    });
  }, [project.rootPath]);
  const mutate = (fn: (b: ProjectBriefInput) => void) => {
    if (!brief) return;
    const n = structuredClone(brief);
    fn(n);
    setBrief(n);
  };
  return (
    <section className="panel">
      <h3>基本設定</h3>
      {brief && (
        <div className="formgrid">
          <label>
            プロジェクト名
            <input
              value={brief.project.title}
              onChange={(e) => mutate((b) => (b.project.title = e.target.value))}
            />
          </label>
          <label>
            プロジェクトID
            <input value={brief.project.id} disabled />
          </label>
          <label>
            キャラクター
            <input
              value={brief.subject.characterName}
              onChange={(e) => mutate((b) => (b.subject.characterName = e.target.value))}
            />
          </label>
          <label>
            作品
            <input
              value={brief.subject.series}
              onChange={(e) => mutate((b) => (b.subject.series = e.target.value))}
            />
          </label>
          <label>
            目標画像枚数
            <input
              type="number"
              value={brief.generation.target_image_count}
              onChange={(e) => mutate((b) => (b.generation.target_image_count = +e.target.value))}
            />
          </label>
          <label className="wide">
            ターゲット
            <textarea
              value={brief.audience}
              onChange={(e) => mutate((b) => (b.audience = e.target.value))}
            />
          </label>
          <label className="wide">
            要望
            <textarea
              value={brief.request}
              onChange={(e) => mutate((b) => (b.request = e.target.value))}
            />
          </label>
          <label className="wide">
            除外
            <textarea
              value={brief.exclusions}
              onChange={(e) => mutate((b) => (b.exclusions = e.target.value))}
            />
          </label>
        </div>
      )}
      <button
        className="primary"
        disabled={!brief}
        onClick={() =>
          brief &&
          run(async () =>
            setProject(await window.batchStudio.project.saveBrief(project.rootPath, brief)),
          )
        }
      >
        基本設定を保存
      </button>
    </section>
  );
}

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { workspace, type Workspace } from './workspace';
export interface ModalContext {
  id: string;
  projectId: string;
  generation: string;
  key: string;
  revision: number;
  leaseId: string;
}
export function assertModalContext(store: Workspace, context: ModalContext) {
  const tab = store.tabs.find(
    (t) => t.id === context.projectId && t.generation === context.generation,
  );
  if (
    !tab ||
    tab.key !== context.key ||
    tab.project.revision !== context.revision ||
    tab.project.lease?.leaseId !== context.leaseId ||
    !tab.project.lease?.ownedByCurrentSession
  )
    throw Error('MODAL_CONTEXT_CHANGED');
  return tab;
}
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const origin = document.activeElement as HTMLElement | null;
    const background = document.getElementById('root')!;
    background.inert = true;
    const controls = () =>
      [
        ...ref.current!.querySelectorAll<HTMLElement>(
          'button,input,select,textarea,a[href],[tabindex="0"]',
        ),
      ].filter(
        (e) => !e.hasAttribute('disabled') && !e.closest('[inert]') && e.getClientRects().length,
      );
    controls()[0]?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close.current();
      }
      if (e.key === 'Tab') {
        const list = controls();
        const active = list.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && active <= 0) {
          e.preventDefault();
          list.at(-1)?.focus();
        } else if (!e.shiftKey && (active < 0 || active === list.length - 1)) {
          e.preventDefault();
          list[0]?.focus();
        }
      }
    };
    window.addEventListener('keydown', handle, true);
    return () => {
      background.inert = false;
      window.removeEventListener('keydown', handle, true);
      if (origin?.isConnected) origin.focus();
      else document.getElementById('tools-button')?.focus();
    };
  }, []);
  return createPortal(
    <div className="modal-backdrop">
      <section ref={ref} role="dialog" aria-modal="true" aria-label={title} className="tool-modal">
        <div className="section-heading">
          <h2>{title}</h2>
          <button aria-label="モーダルを閉じる" onClick={onClose}>
            閉じる
          </button>
        </div>
        {children}
      </section>
    </div>,
    document.body,
  );
}
const names = ['Civitai Explorer', 'R2 Browser', 'Vast.ai', 'サービス連携', '環境設定'];
const states = new Map<string, { search: string; bucket: string; path: string; scroll: number }>();
export function ModalHost() {
  useSyncExternalStore(workspace.subscribe, workspace.snapshot);
  const [open, setOpen] = useState(false);
  const [tool, setTool] = useState(names[0]);
  const [mode, setMode] = useState('manage');
  const [origin, setOrigin] = useState<{ name: string; context: ModalContext } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [, render] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  const confirmation = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const listener = () => {
      const tab = workspace.tabs.find((t) => t.id === workspace.selected);
      setOrigin(
        tab
          ? {
              name: tab.name,
              context: {
                id: crypto.randomUUID(),
                projectId: tab.id,
                generation: tab.generation,
                key: tab.key,
                revision: tab.project.revision,
                leaseId: tab.project.lease?.leaseId ?? '',
              },
            }
          : null,
      );
      setMode('manage');
      setOpen(true);
    };
    window.addEventListener('workspace:tools', listener);
    return () => window.removeEventListener('workspace:tools', listener);
  }, []);
  useEffect(() => {
    if (body.current) {
      body.current.inert = confirm;
      body.current.scrollTop = states.get(tool)?.scroll ?? 0;
    }
    if (confirm) confirmation.current?.querySelector<HTMLButtonElement>('button')?.focus();
    else if (open) cancel.current?.focus();
  }, [tool, confirm]);
  useEffect(() => {
    if (!workspace.user) setOpen(false);
  }, [workspace.user]);
  if (!open) return null;
  if (!states.has(tool)) states.set(tool, { search: '', bucket: '', path: '', scroll: 0 });
  const state = states.get(tool)!;
  const update = (field: 'search' | 'bucket' | 'path', value: string) => {
    state[field] = value;
    render((v) => v + 1);
  };
  let valid = false;
  try {
    if (origin) {
      assertModalContext(workspace, origin.context);
      valid = true;
    }
  } catch {
    valid = false;
  }
  return (
    <Dialog
      title={tool}
      onClose={() => {
        if (confirm) setConfirm(false);
        else setOpen(false);
      }}
    >
      <div
        ref={body}
        className="tool-body"
        onScroll={(e) => (state.scroll = e.currentTarget.scrollTop)}
      >
        <nav className="tool-nav" aria-label="ツール">
          <select aria-label="ツール種類" value={tool} onChange={(e) => setTool(e.target.value)}>
            {names.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
          <button ref={cancel} onClick={() => setConfirm(true)}>
            表示状態をリセット
          </button>
        </nav>
        <label>
          用途
          <select aria-label="用途" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="manage">管理</option>
            <option value="select" disabled={!origin}>
              Project選択
            </option>
          </select>
        </label>
        {mode === 'select' && (
          <p>
            対象: {origin?.name} / {origin?.context.key}{' '}
            {!valid ? '— 選択contextが失効しました。' : ''}
          </p>
        )}
        {tool === 'R2 Browser' ? (
          <>
            <label>
              Bucket
              <input value={state.bucket} onChange={(e) => update('bucket', e.target.value)} />
            </label>
            <label>
              パス
              <input value={state.path} onChange={(e) => update('path', e.target.value)} />
            </label>
          </>
        ) : (
          <label>
            検索
            <input value={state.search} onChange={(e) => update('search', e.target.value)} />
          </label>
        )}
        <div className="unavailable">
          <h3>外部サービスは未接続です</h3>
          <p>検索・同期・管理・転送はP5で接続します。表示条件はモーダルを閉じても保持されます。</p>
          <button disabled>
            {mode === 'select' ? 'Projectへ選択を確定' : '操作を実行'}（未接続）
          </button>
        </div>
      </div>
      {confirm && (
        <div
          ref={confirmation}
          role="alertdialog"
          aria-modal="true"
          aria-label="表示状態リセット確認"
        >
          <h3>表示条件をリセットしますか？</h3>
          <p>開始済みjobは停止しません。</p>
          <button onClick={() => setConfirm(false)}>取消</button>
          <button
            onClick={() => {
              states.set(tool, { search: '', bucket: '', path: '', scroll: 0 });
              setConfirm(false);
              render((v) => v + 1);
            }}
          >
            表示条件をリセット
          </button>
        </div>
      )}
    </Dialog>
  );
}

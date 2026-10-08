import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  IntegrationTool,
  Observation,
  type ToolConfirmation,
  type ToolState,
} from './integration-tools';
import { type Workspace, workspace } from './workspace';
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
const states = new Map<string, ToolState>();
export function ModalHost() {
  useSyncExternalStore(workspace.subscribe, workspace.snapshot);
  const [open, setOpen] = useState(false);
  const [tool, setTool] = useState(names[0]);
  const [mode, setMode] = useState('manage');
  const [origin, setOrigin] = useState<{ name: string; context: ModalContext } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [external, setExternal] = useState<ToolConfirmation | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const [, render] = useState(0);
  const stateKey = workspace.user + ':' + tool;
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
      setConfirm(false);
      setExternal(null);
      setConfirmError('');
      setMode('manage');
      setOpen(true);
    };
    window.addEventListener('workspace:tools', listener);
    return () => window.removeEventListener('workspace:tools', listener);
  }, []);
  useEffect(() => {
    if (body.current) {
      body.current.inert = confirm;
      body.current.scrollTop = states.get(stateKey)?.scroll ?? 0;
    }
    if (confirm) confirmation.current?.querySelector<HTMLButtonElement>('button')?.focus();
    else if (open) cancel.current?.focus();
  }, [stateKey, confirm]);
  useEffect(() => {
    if (!workspace.authenticated) setOpen(false);
  }, [workspace.authenticated]);
  if (!open) return null;
  if (!states.has(stateKey)) states.set(stateKey, { search: '', bucket: '', path: '', scroll: 0 });
  const state = states.get(stateKey)!;
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
        if (confirm) {
          if (!confirmBusy) {
            setConfirm(false);
            setExternal(null);
          }
          return;
        }
        setOpen(false);
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
          <button
            ref={cancel}
            onClick={() => {
              setExternal(null);
              setConfirmError('');
              setConfirm(true);
            }}
          >
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
        <IntegrationTool
          key={stateKey}
          tool={tool}
          state={state}
          mode={mode}
          origin={origin?.context ?? null}
          onOrigin={(context) =>
            setOrigin((previous) => (previous ? { ...previous, context } : null))
          }
          onConfirm={(request) => {
            setExternal(request);
            setConfirmError('');
            setConfirm(true);
          }}
        />
      </div>
      {confirm && (
        <div
          ref={confirmation}
          role="alertdialog"
          aria-modal="true"
          aria-label={external ? '外部操作の確認' : '表示状態リセット確認'}
        >
          <h3>{external ? external.title : '表示条件をリセットしますか？'}</h3>
          {external && <Observation value={external.summary} />}
          {confirmError && <p role="alert">{confirmError}</p>}
          <p>開始済みjobは停止しません。</p>
          <button
            disabled={confirmBusy}
            onClick={() => {
              setConfirm(false);
              setExternal(null);
            }}
          >
            取消
          </button>
          <button
            disabled={confirmBusy}
            onClick={() => {
              if (external) {
                setConfirmBusy(true);
                void external
                  .submit()
                  .then(() => {
                    setConfirm(false);
                    setExternal(null);
                  })
                  .catch((e) => setConfirmError(e.message))
                  .finally(() => setConfirmBusy(false));
                return;
              }
              states.set(stateKey, { search: '', bucket: '', path: '', scroll: 0 });
              setConfirm(false);
              render((v) => v + 1);
            }}
          >
            {external ? '確認して実行' : '表示条件をリセット'}
          </button>
        </div>
      )}
    </Dialog>
  );
}

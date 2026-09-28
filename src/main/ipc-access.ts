import path from 'node:path';
import { IPC } from '../shared/ipc.js';

export type IpcSenderKind =
  | 'project-local'
  | 'project-codex'
  | 'thumbnail-picker'
  | 'marketplace-picker'
  | 'tool-r2'
  | 'tool-civit'
  | 'tool-vastai'
  | 'unknown';

export interface IpcSenderContext {
  kind: IpcSenderKind;
  projectRoot?: string | null;
}

export interface IpcAccessPolicy {
  senders: readonly IpcSenderKind[];
  rootArg?: number;
  write?: boolean;
  writeRootFromSender?: boolean;
}

export interface IpcAccessDecision {
  writeRoot: string | null;
}

type IpcChannel = (typeof IPC)[keyof typeof IPC];

const policies = new Map<IpcChannel, IpcAccessPolicy>();
const policy = (
  definition: IpcAccessPolicy,
  ...channels: IpcChannel[]
) => {
  for (const channel of channels) {
    if (policies.has(channel)) throw new Error(`Duplicate IPC access policy: ${channel}`);
    policies.set(channel, definition);
  }
};

const PROJECT_LOCAL = ['project-local'] as const;
const PROJECT_AND_CODEX = ['project-local', 'project-codex'] as const;
const R2_TOOL = ['project-local', 'tool-r2'] as const;
const CIVIT_TOOL = ['project-local', 'tool-civit'] as const;
const VAST_TOOL = ['project-local', 'tool-vastai'] as const;
const TRUSTED_LOCAL_UI = [
  'project-local',
  'project-codex',
  'tool-r2',
  'tool-civit',
  'tool-vastai',
] as const;
const THUMBNAIL_READERS = ['project-local', 'thumbnail-picker'] as const;
const MARKETPLACE_READERS = ['project-local', 'marketplace-picker'] as const;
const PICKER_CACHE_WRITERS = ['thumbnail-picker', 'marketplace-picker'] as const;

policy(
  { senders: PROJECT_LOCAL },
  IPC.EDITOR_FLUSH_RESULT,
  IPC.APP_SETTINGS_GET,
  IPC.APP_SETTINGS_SELECT_COMFYUI,
  IPC.APP_SETTINGS_SAVE,
  IPC.PROJECT_SELECT,
  IPC.PROJECT_LAST,
  IPC.PROJECT_RECENT,
  IPC.PROJECT_REMOVE_RECENT,
  IPC.PROJECT_OPEN,
  IPC.PROJECT_CLOSE,
  IPC.PROJECT_SELECT_PARENT,
  IPC.PROJECT_CREATE,
  IPC.FILE_SHOW_IN_FOLDER,
  IPC.THUMBNAIL_FONTS,
  IPC.THUMBNAIL_READ_IMAGE,
  IPC.THUMBNAIL_READ_EDITOR_IMAGE,
  IPC.THUMBNAIL_READ_TEMPLATE,
  IPC.THUMBNAIL_PICKER_PREVIEW_RESULT,
  IPC.THUMBNAIL_PICKER_COMMIT_RESULT,
  IPC.MARKETPLACE_TARGETS,
  IPC.MARKETPLACE_PICKER_PREVIEW_RESULT,
  IPC.MARKETPLACE_PICKER_COMMIT_RESULT,
  IPC.ASSISTANT_GET_PROVIDER,
  IPC.CODEX_GET_PROVIDER,
  IPC.ASSISTANT_SET_PROVIDER,
  IPC.CODEX_SET_PROVIDER,
  IPC.CODEX_SET_CONTEXT,
  IPC.CODEX_SELECT_STAGE_TASK,
  IPC.GROK_SET_VISIBLE,
  IPC.GROK_SET_CONTEXT,
  IPC.GROK_SET_RATIO,
  IPC.GROK_SET_DIVIDER_X,
  IPC.GROK_RELOAD,
  IPC.GROK_OPEN_EXTERNAL,
);

policy(
  { senders: PROJECT_AND_CODEX },
  IPC.CODEX_CONTEXT,
  IPC.CODEX_STATUS,
  IPC.CODEX_SIGN_IN,
  IPC.CODEX_SNAPSHOT,
  IPC.CODEX_MODELS,
  IPC.CODEX_SELECT_MODEL,
  IPC.CODEX_NEW_CHAT,
  IPC.CODEX_RESTORE_CHAT,
  IPC.CODEX_STOP_TURN,
  IPC.CODEX_SEND,
  IPC.CODEX_SEND_TASK,
  IPC.CODEX_LATEST_ARTIFACT,
  IPC.CODEX_RETRY_ARTIFACT,
  IPC.CODEX_SAVE_RESPONSE,
);

policy({ senders: TRUSTED_LOCAL_UI }, IPC.CLIPBOARD_WRITE_TEXT);

policy(
  { senders: PROJECT_LOCAL, rootArg: 0 },
  IPC.PROJECT_SCAN,
  IPC.PROJECT_OPEN_FOLDER,
  IPC.ARTIFACT_READ,
  IPC.ARTIFACT_GROK_LORA_HISTORY,
  IPC.GROK_TASK_BUILD,
  IPC.CATALOG_STATUS,
  IPC.AVAILABILITY_CHECK,
  IPC.AVAILABILITY_CHECK_LORA_FILES,
  IPC.AVAILABILITY_OPEN_R2,
  IPC.PREFLIGHT_RUN,
  IPC.EXECUTION_STATUS,
  IPC.EXECUTION_STORAGE_DIAGNOSTICS,
  IPC.EXECUTION_GET,
  IPC.FINAL_ARTIFACT_STATUS,
  IPC.FINAL_ARTIFACT_READ_IMAGE,
  IPC.FINAL_ARTIFACT_READ_PREVIEW,
  IPC.CAPTION_STATUS,
  IPC.THUMBNAIL_LOAD,
  IPC.THUMBNAIL_SELECT_IMAGE,
  IPC.MARKETPLACE_LOAD,
  IPC.MARKETPLACE_RENDER_PNG,
);

policy(
  { senders: PROJECT_LOCAL, rootArg: 0, write: true },
  IPC.PROJECT_SAVE_SETTINGS,
  IPC.PROJECT_SAVE_BRIEF,
  IPC.ARTIFACT_BEGIN_EDIT,
  IPC.ARTIFACT_SAVE_DRAFT,
  IPC.ARTIFACT_IMPORT_GROK,
  IPC.ARTIFACT_CONFIRM,
  IPC.ARTIFACT_RESET_FROM,
  IPC.PROMPT_PLAN_SAVE,
  IPC.AUTO_ARTIFACT_GROK_ARM,
  IPC.CATALOG_LINK_PROJECT,
  IPC.WORKFLOW_COMPILE,
  IPC.EXECUTION_START,
  IPC.EXECUTION_RESTORE_BACKUP,
  IPC.EXECUTION_LEAVE,
  IPC.EXECUTION_STOP_FOR_EDIT,
  IPC.EXECUTION_DISCARD_FOR_EDIT,
  IPC.EXECUTION_RECONCILE,
  IPC.EXECUTION_STOP_SCHEDULING,
  IPC.EXECUTION_FORCE_INTERRUPT,
  IPC.EXECUTION_RESUME,
  IPC.EXECUTION_RESTART_REMOTE,
  IPC.EXECUTION_RESTART_FROM_SCRATCH,
  IPC.FINAL_ARTIFACT_SELECT_DIRECTORY,
  IPC.CAPTION_SELECT_SOURCE_DIRECTORY,
  IPC.CAPTION_IMPORT_GROK,
  IPC.CAPTION_GENERATE,
  IPC.CAPTION_SAVE_PIXIV_TITLE,
  IPC.THUMBNAIL_RESTORE_BACKUP,
  IPC.THUMBNAIL_INITIALIZE_CORRUPT,
  IPC.THUMBNAIL_SAVE,
  IPC.THUMBNAIL_EXPORT,
  IPC.THUMBNAIL_DELETE_OUTPUTS,
  IPC.MARKETPLACE_RESTORE_BACKUP,
  IPC.MARKETPLACE_INITIALIZE_CORRUPT,
  IPC.MARKETPLACE_SAVE,
  IPC.MARKETPLACE_GENERATE,
  IPC.MARKETPLACE_GENERATE_ZIP,
  IPC.MARKETPLACE_EXPORT_CUSTOM,
);

policy(
  { senders: THUMBNAIL_READERS, rootArg: 0 },
  IPC.THUMBNAIL_LIST_IMAGES,
);

policy(
  { senders: MARKETPLACE_READERS, rootArg: 0 },
  IPC.FINAL_ARTIFACT_LIST_IMAGES,
  IPC.MARKETPLACE_LIST_THUMBNAILS,
  IPC.MARKETPLACE_READ_SOURCE,
  IPC.MARKETPLACE_READ_SOURCE_PREVIEW,
);

policy(
  { senders: PROJECT_LOCAL, rootArg: 0 },
  IPC.THUMBNAIL_PICKER_OPEN,
  IPC.MARKETPLACE_PICKER_OPEN,
);

policy(
  { senders: ['thumbnail-picker'] },
  IPC.THUMBNAIL_PICKER_CONTEXT,
  IPC.THUMBNAIL_PICKER_PERF,
  IPC.THUMBNAIL_PICKER_PERF_OPEN,
  IPC.THUMBNAIL_PICKER_PREVIEW,
  IPC.THUMBNAIL_READ_PREVIEW,
);

policy(
  { senders: ['thumbnail-picker'], write: true, writeRootFromSender: true },
  IPC.THUMBNAIL_PICKER_COMMIT,
);

policy(
  { senders: ['marketplace-picker'] },
  IPC.MARKETPLACE_PICKER_CONTEXT,
  IPC.MARKETPLACE_PICKER_PREVIEW,
);

policy(
  { senders: ['marketplace-picker'], write: true, writeRootFromSender: true },
  IPC.MARKETPLACE_PICKER_COMMIT,
);

policy(
  { senders: PICKER_CACHE_WRITERS },
  IPC.THUMBNAIL_STORE_WEBP_PREVIEW,
);

policy(
  { senders: CIVIT_TOOL },
  IPC.CATALOG_INTEGRATED_STATUS,
  IPC.CATALOG_INTEGRATED_SNAPSHOT,
  IPC.CATALOG_INTEGRATED_SYNC,
  IPC.CATALOG_TEMPLATES,
  IPC.CATALOG_SAVE_TEMPLATE,
  IPC.CATALOG_DELETE_TEMPLATE,
  IPC.CATALOG_OPEN_MODEL,
  IPC.CIVITAI_SETTINGS,
  IPC.CIVITAI_SAVE_SETTINGS,
);

policy(
  { senders: VAST_TOOL },
  IPC.VASTAI_SETTINGS,
  IPC.VASTAI_SAVE_SETTINGS,
  IPC.VASTAI_TEST,
  IPC.VASTAI_SELECT_PRIVATE_KEY,
  IPC.VASTAI_SELECT_PUBLIC_KEY,
  IPC.VASTAI_INSTANCES,
  IPC.VASTAI_COMFYUI_TEMPLATE,
  IPC.VASTAI_SEARCH_OFFERS,
  IPC.VASTAI_RENT_OFFER,
  IPC.VASTAI_START_INSTANCE,
  IPC.VASTAI_STOP_INSTANCE,
  IPC.VASTAI_DESTROY_INSTANCE,
  IPC.VASTAI_REBOOT_INSTANCE,
  IPC.VASTAI_RESOLVE_SSH,
);

policy(
  { senders: R2_TOOL },
  IPC.R2_SETTINGS,
  IPC.R2_ENVIRONMENT,
  IPC.R2_TEST,
  IPC.R2_SAVE_SETTINGS,
  IPC.R2_BUCKETS,
  IPC.R2_CREATE_BUCKET,
  IPC.R2_DELETE_BUCKET,
  IPC.R2_LIST,
  IPC.R2_SEARCH,
  IPC.R2_DOWNLOAD_INFO,
  IPC.R2_BATCH_DOWNLOAD_INFO,
  IPC.R2_PUT_URL_INFO,
  IPC.R2_DELETE_OBJECTS,
  IPC.R2_MOVE,
  IPC.R2_SELECT_UPLOAD_FILES,
  IPC.R2_BEGIN_UPLOAD,
  IPC.R2_UPLOADS,
  IPC.R2_RESUME_UPLOAD,
  IPC.R2_PAUSE_UPLOAD,
  IPC.R2_CANCEL_UPLOAD,
  IPC.R2_TEMPLATES,
  IPC.R2_SAVE_TEMPLATE,
  IPC.R2_DELETE_TEMPLATE,
  IPC.R2_METRICS,
);

export function ipcAccessPolicy(channel: string): IpcAccessPolicy | null {
  return policies.get(channel as IpcChannel) ?? null;
}

function rootKey(root: string) {
  const resolved = path.resolve(root);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function authorizeIpcAccess(
  channel: string,
  sender: IpcSenderContext,
  args: readonly unknown[],
): IpcAccessDecision {
  const definition = ipcAccessPolicy(channel);
  if (!definition) throw new Error('IPC access policy is not defined.');
  if (!definition.senders.includes(sender.kind)) {
    throw new Error('この操作は現在のWindowから実行できません。');
  }

  let requestedRoot: string | null = null;
  if (definition.rootArg !== undefined) {
    const candidate = args[definition.rootArg];
    if (typeof candidate !== 'string' || !candidate.trim()) {
      throw new Error('Project rootが不正です。');
    }
    requestedRoot = candidate;
    if (!sender.projectRoot || rootKey(sender.projectRoot) !== rootKey(candidate)) {
      throw new Error('このWindowで開いているProjectと操作対象が一致しません。');
    }
  }

  const writeRoot = definition.write
    ? definition.writeRootFromSender
      ? sender.projectRoot ?? null
      : requestedRoot
    : null;
  if (definition.write && !writeRoot) {
    throw new Error('変更対象のProjectを確認できません。');
  }
  return { writeRoot };
}

export function definedIpcAccessChannels() {
  return [...policies.keys()].sort();
}

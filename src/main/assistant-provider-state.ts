import path from 'node:path';
import { AssistantProviderPreferences } from '../application/assistant-provider-preferences.js';
import { readJson, writeJsonAtomic, withTemplateStoreLock } from './fs-utils.js';
export {
  isAssistantProvider,
  isAssistantStage,
} from '../application/assistant-provider-preferences.js';
export class AssistantProviderStore extends AssistantProviderPreferences {
  constructor(userDataPath: string) {
    const file = path.join(userDataPath, 'assistant-provider-state.json');
    super({
      key: (root) => {
        const resolved = path.resolve(root);
        return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
      },
      exclusive: (work) => withTemplateStoreLock(file, work),
      read: () => readJson(file),
      write: (state) => writeJsonAtomic(file, state),
    });
  }
}

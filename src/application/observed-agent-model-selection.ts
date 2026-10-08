import {
  selectAvailableAgentModel,
  type AgentModelCapabilities,
} from '../domain/agent-model-policy.js';
import type { AgentModelSelection } from '../domain/agent-state-policy.js';
export interface ObservedModelSelectionPorts {
  capabilities(): Promise<AgentModelCapabilities>;
  save(selection: AgentModelSelection): Promise<void>;
}
export async function chooseObservedAgentModel(
  ports: ObservedModelSelectionPorts,
  selection: unknown,
): Promise<AgentModelSelection> {
  if (
    !selection ||
    typeof selection !== 'object' ||
    !('model' in selection) ||
    ((selection as AgentModelSelection).model !== null &&
      typeof (selection as AgentModelSelection).model !== 'string')
  )
    throw new Error('AIモデルを選択してください。');
  const capabilities = await ports.capabilities();
  const normalized = selectAvailableAgentModel(selection as AgentModelSelection, capabilities);
  await ports.save(normalized);
  return normalized;
}

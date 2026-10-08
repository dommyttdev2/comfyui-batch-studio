import { type AgentModelSelection, validateAgentModelSelection } from './agent-state-policy.js';
import { BusinessError } from './contracts.js';

export interface AgentModelCapabilities {
  models: readonly { id: string; supportedReasoningEfforts?: readonly string[] }[];
  defaultModelId: string | null;
}

export function selectAvailableAgentModel(
  value: AgentModelSelection,
  capabilities: AgentModelCapabilities,
) {
  const selection = validateAgentModelSelection(value);
  const selectedId = selection.model ?? capabilities.defaultModelId;
  const model = capabilities.models.find((item) => item.id === selectedId);
  if (selection.model !== null && !model)
    throw new BusinessError('INVALID_INPUT', '選択したモデルは利用できません。');
  if (
    selection.reasoningEffort &&
    !model?.supportedReasoningEfforts?.includes(selection.reasoningEffort)
  )
    throw new BusinessError('INVALID_INPUT', '選択した推論強度はこのモデルで利用できません。');
  return selection;
}

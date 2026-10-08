import {
  createGrokCliTaskRunner,
  type GrokCliTaskRunnerOptions,
} from '../application/grok-cli-task-runner.js';
import { agentRuntimePorts } from './agent-runtime-ports.js';
export type { GrokCliTaskRunnerOptions } from '../application/grok-cli-task-runner.js';
export const GrokCliTaskRunner = createGrokCliTaskRunner(agentRuntimePorts);
export type GrokCliTaskRunner = InstanceType<typeof GrokCliTaskRunner>;

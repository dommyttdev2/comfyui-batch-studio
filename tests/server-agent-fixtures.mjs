import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { expectedArtifact } from '../dist-server/domain/agent-artifact-policy.js';
export function fixtureAgents(directory, options = {}) {
  const state = { starts: 0, resumes: 0, privateSessions: [], tasks: [], active: new Set() };
  return {
    state,
    directory,
    stopped: async (_scope, id) => !state.active.has(id),
    terminate: async (_scope, id) => state.active.delete(id),
    adapter: (scope, jobId) => {
      let pending,
        stop = false;
      let release;
      const adapter = {
        provider: scope.provider,
        capabilities: {},
        checkAvailability: async () => ({
          provider: scope.provider,
          state: 'available',
          version: 'fixture',
          message: null,
        }),
        getModels: async () => ({
          models: [
            {
              id: 'fixture-model',
              displayName: 'Fixture Model',
              supportedReasoningEfforts: ['low', 'high'],
            },
          ],
          selection: { model: 'fixture-model' },
        }),
        startTask: async (task, sink) => launch(task, sink, null),
        resumeTask: async (id, task, sink) => {
          state.resumes++;
          return launch(task, sink, id);
        },
        waitForCompletion: async () => {
          await pending;
          state.active.delete(jobId);
          if (stop) throw new Error('Stopped');
        },
        stop: async () => {
          stop = true;
          state.active.delete(jobId);
          release?.();
        },
        shutdown: async () => {
          stop = true;
          state.active.delete(jobId);
          release?.();
        },
      };
      async function launch(task, sink, resume) {
        state.starts++;
        state.tasks.push(task);
        state.active.add(jobId);
        const sessionId = resume ?? randomUUID(),
          turnId = randomUUID();
        state.privateSessions.push(sessionId);
        sink({ type: 'session.started', at: Date.now(), sessionId });
        sink({ type: 'turn.started', at: Date.now(), turnId });
        pending = new Promise((r) => (release = r));
        setTimeout(async () => {
          if (stop) return;
          try {
            const name = expectedArtifact(task.taskStage);
            if (name) {
              await mkdir(path.join(task.workspace.directory, 'output'), { recursive: true });
              await writeFile(
                path.join(task.workspace.directory, 'output', name),
                options.output ?? '# Fixture story',
              );
            }
            sink({
              type: 'message.completed',
              at: Date.now(),
              text: options.response ?? 'Fixture ' + scope.provider + ' answer',
            });
            if (!options.hold) release();
          } catch {
            release();
          }
        }, options.delay ?? 10);
        return { provider: scope.provider, sessionId, turnId };
      }
      return adapter;
    },
  };
}
export const brief = {
  project: { id: 'acceptance', title: 'Acceptance' },
  subject: { copyrightedCharacter: false, characterName: 'Adult explorer', series: '' },
  audience: 'General',
  request: 'One scene of an adult explorer finding a library.',
  exclusions: '',
  assumptions: { adultCharacters: true, consensual: true },
  generation: { target_image_count: 1, modelFamily: 'illustrious' },
};
export async function seedBrief(runtime, actor, id) {
  let p = await runtime.repository.execute(actor, id, 'seed-lease', {}, () =>
    runtime.projectApi.projects.acquireLease(actor, { projectId: id }),
  );
  const leaseId = p.project.lease.id;
  p = await runtime.repository.execute(actor, id, 'seed-brief', {}, () =>
    runtime.projectApi.projects.saveDraft(actor, {
      projectId: id,
      expectedRevision: p.project.revision,
      leaseId,
      key: 'brief',
      content: JSON.stringify(brief),
    }),
  );
  p = await runtime.repository.execute(actor, id, 'seed-confirm', {}, () =>
    runtime.projectApi.projects.confirm(actor, {
      projectId: id,
      expectedRevision: p.project.revision,
      leaseId,
      key: 'brief',
    }),
  );
  return p.project;
}

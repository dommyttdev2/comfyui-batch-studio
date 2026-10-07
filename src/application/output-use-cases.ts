import type {
  CaptionContent,
  MarketplaceImageEditorState,
  MarketplaceImageTarget,
  ThumbnailEditorState,
} from '../domain/artifact-types.js';
import { parseArtifact } from '../domain/canonical-artifact.js';
import {
  assertCaptionBuildable,
  assessCaptionBuild,
  type CaptionBuildFacts,
  captionContentHash,
  captionRenderInputHash,
} from '../domain/caption-build-policy.js';
import { validateCaptionContent } from '../domain/caption-policy.js';
import type { ActorContext, Command, MutationCommand } from '../domain/contracts.js';
import { authorize, BusinessError } from '../domain/contracts.js';
import { assessFinalArtifact } from '../domain/final-artifact-policy.js';
import {
  normalizeMarketplaceImageState,
  validateMarketplaceTargets,
  validMarketplaceState,
} from '../domain/marketplace-editor-policy.js';
import {
  assertMarketplaceOutput,
  type MarketplaceGenerationManifest,
  type MarketplaceSourceFingerprint,
  validateMarketplaceGeneration,
} from '../domain/marketplace-generation-policy.js';
import { normalizeThumbnailState, validThumbnailState } from '../domain/thumbnail-editor-policy.js';
import { formatIsoUtc } from '../domain/time-policy.js';
import { canonical } from '../domain/workflow-graph.js';
import { assertCurrentProject, assertMutation, nextRevision } from './project-access.js';
import { type Clock, event, type ProjectRepository, type ProjectState } from './project-ports.js';
import type { Digest } from './workflow-use-cases.js';
export interface OutputFactsPort {
  caption(
    projectId: string,
  ): Promise<Omit<CaptionBuildFacts, 'validation' | 'content' | 'actualCaption' | 'build'>>;
  marketplace(projectId: string): Promise<{
    manifest: MarketplaceGenerationManifest | null;
    targets: MarketplaceImageTarget[];
    source: MarketplaceSourceFingerprint;
    outputs: { targetId: string; size: number; sha256: string }[];
  }>;
}
export class OutputUseCases {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly facts: OutputFactsPort,
    private readonly digest: Digest,
    private readonly clock: Clock,
  ) {}
  private async captionFacts(projectId: string, project?: ProjectState) {
    const current = project ?? (await this.projects.transaction(projectId, (tx) => tx.load()));
    assertCurrentProject(current, projectId);
    const observed = await this.facts.caption(projectId);
    const artifact = current.drafts.caption ?? current.artifacts.caption;
    const content = artifact ? (parseArtifact(artifact.content) as CaptionContent) : null;
    return {
      ...observed,
      artifactStale: artifact?.status === 'stale',
      content,
      actualCaption: current.captionOutput?.text ?? null,
      build: current.captionOutput?.build ?? null,
    };
  }
  async captionStatus(actor: ActorContext, command: Command) {
    authorize(actor, command.projectId, 'read');
    const facts = await this.captionFacts(command.projectId);
    const validation = facts.artifactStale
      ? {
          valid: false,
          issues: [
            {
              severity: 'error' as const,
              code: 'ARTIFACT_STALE',
              message: 'Caption inputs are stale.',
            },
          ],
        }
      : facts.content?.schemaVersion === 2
        ? validateCaptionContent(facts.content)
        : {
            valid: false,
            issues: [
              {
                severity: 'error' as const,
                code: facts.content ? 'CAPTION_CURRENT_SCHEMA_REQUIRED' : 'CAPTION_CONTENT_MISSING',
                message: 'Caption content required.',
              },
            ],
          };
    return assessCaptionBuild({ ...facts, validation }, (value) => this.digest.text(value));
  }
  async generateCaption(actor: ActorContext, command: MutationCommand) {
    authorize(actor, command.projectId, 'edit');
    return this.projects.transaction(command.projectId, async (tx) => {
      const project = await tx.load();
      assertMutation(actor, command, project, this.clock);
      const facts = await this.captionFacts(project.id, project);
      if (facts.artifactStale || facts.content?.schemaVersion !== 2)
        throw new BusinessError('INVALID_ARTIFACT', 'Caption v2 required.');
      const validation = validateCaptionContent(facts.content);
      const input = { ...facts, validation },
        status = assessCaptionBuild(input, (value) => this.digest.text(value));
      assertCaptionBuildable(input, status.preview);
      const content = facts.content as CaptionContent,
        source = facts.sourceDirectory!;
      const build = {
        schemaVersion: 1 as const,
        sourceDirectory: source,
        imageCount: facts.imageCount,
        contentSha256: captionContentHash(content, (value) => this.digest.text(value)),
        renderInputSha256: captionRenderInputHash(
          content,
          facts.imageCount,
          source,
          facts.copyrightedCharacter,
          (value) => this.digest.text(value),
        ),
        outputSha256: this.digest.text(status.preview),
        generatedAt: formatIsoUtc(this.clock.now()),
      };
      project.captionOutput = { text: status.preview, build };
      const before = project.revision;
      project.revision = nextRevision(project);
      await tx.commit(before, project, event(actor, project, 'project.changed', 'caption'));
      return project;
    });
  }
  async marketplaceStatus(actor: ActorContext, command: Command) {
    authorize(actor, command.projectId, 'read');
    const data = await this.facts.marketplace(command.projectId);
    const project = await this.projects.transaction(command.projectId, (tx) => tx.load());
    assertCurrentProject(project, command.projectId);
    if (!project.editors?.marketplace)
      throw new BusinessError('INVALID_ARTIFACT', 'Saved marketplace state required.');
    const state = project.editors.marketplace;
    const targets = validateMarketplaceTargets({ schemaVersion: 1, targets: data.targets });
    validateMarketplaceGeneration(data.manifest, state, targets, data.source);
    const extension = state.format === 'jpeg' ? 'jpg' : state.format;
    for (const target of targets) {
      const outputs = data.outputs.filter((output) => output.targetId === target.id);
      if (outputs.length !== 1)
        throw new BusinessError('INVALID_ARTIFACT', 'Generated target is missing or duplicated.');
      const expected = data.manifest!.outputs.filter((output) => output.targetId === target.id);
      if (expected.length !== 1)
        throw new BusinessError('INVALID_ARTIFACT', 'Manifest target is missing or duplicated.');
      assertMarketplaceOutput(expected[0], target, extension, outputs[0]);
    }
    return { state: 'generated' as const };
  }
  async finalArtifactStatus(actor: ActorContext, command: Command) {
    authorize(actor, command.projectId, 'read');
    const facts = await this.facts.caption(command.projectId);
    return assessFinalArtifact(facts.sourceDirectory, facts.sourceExists, facts.imageCount);
  }
  async saveEditor(
    actor: ActorContext,
    command: MutationCommand &
      (
        | { kind: 'thumbnail'; state: ThumbnailEditorState; fontFamily: string }
        | {
            kind: 'marketplace';
            state: MarketplaceImageEditorState;
          }
      ),
  ) {
    authorize(actor, command.projectId, 'edit');
    return this.projects.transaction(command.projectId, async (tx) => {
      const project = await tx.load();
      assertMutation(actor, command, project, this.clock);
      if (
        !['thumbnail', 'marketplace'].includes(command.kind) ||
        !command.state ||
        command.state.schemaVersion !== 1
      )
        throw new BusinessError('INVALID_INPUT', 'Current editor state required.');
      if (
        !(command.kind === 'thumbnail'
          ? validThumbnailState(command.state)
          : validMarketplaceState(command.state))
      )
        throw new BusinessError('INVALID_INPUT', 'Invalid editor structure.');
      const normalized =
        command.kind === 'thumbnail'
          ? normalizeThumbnailState(command.state, command.fontFamily)
          : normalizeMarketplaceImageState(
              command.state,
              validateMarketplaceTargets({
                schemaVersion: 1,
                targets: (await this.facts.marketplace(project.id)).targets,
              }),
            );
      const withoutRevision = (value: object) => {
        const { saveRevision: _revision, ...rest } = value as { saveRevision?: number };
        return canonical(rest);
      };
      if (
        JSON.stringify(withoutRevision(normalized)) !==
        JSON.stringify(withoutRevision(command.state))
      )
        throw new BusinessError('INVALID_INPUT', 'Incomplete or invalid editor state.');
      normalized.saveRevision = nextRevision(project);
      project.editors = { ...project.editors, [command.kind]: normalized };
      const before = project.revision;
      project.revision = nextRevision(project);
      await tx.commit(before, project, event(actor, project, 'project.changed', command.kind));
      return project;
    });
  }
}

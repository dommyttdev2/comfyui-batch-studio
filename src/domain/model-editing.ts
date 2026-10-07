import type {
  ModelCatalog,
  ModelFamily,
  ModelSelectionBase,
  ModelsArtifact,
  TextEncoderSelection,
  VaeSelection,
} from './artifact-types.js';
import { BusinessError } from './contracts.js';
export interface BaseModelCommand {
  family: ModelFamily | null;
  base: ModelSelectionBase | null;
  catalog: ModelCatalog | null;
  textEncoder?: TextEncoderSelection | null;
  vae?: VaeSelection | null;
}
export function configureBaseModels(command: BaseModelCommand): ModelsArtifact {
  const { family, base, catalog, textEncoder, vae } = command;
  if (!family || !['illustrious', 'anima'].includes(family) || !base || !catalog)
    throw new BusinessError(
      'INVALID_INPUT',
      'Model family, base selection and catalog are required.',
    );
  const provenance = {
    schemaVersion: catalog.schemaVersion,
    generation: catalog.generation,
    generatedAt: catalog.generatedAt,
  };
  if (family === 'anima') {
    if (!textEncoder || !vae)
      throw new BusinessError('INVALID_INPUT', 'Anima requires a Text Encoder and VAE.');
    return {
      schemaVersion: 5,
      modelFamily: family,
      catalog: provenance,
      diffusionModel: { ...base, ref: 'diffusion_model.main' },
      textEncoder,
      vae,
      loras: [],
    };
  }
  return {
    schemaVersion: 5,
    modelFamily: family,
    catalog: provenance,
    checkpoint: { ...base, ref: 'checkpoint.main' },
    loras: [],
  };
}
export function replaceModelSelection(
  models: ModelsArtifact,
  expected: ModelSelectionBase,
  next: ModelSelectionBase,
): ModelsArtifact {
  const existing =
    expected.ref === 'checkpoint.main'
      ? models.checkpoint
      : expected.ref === 'diffusion_model.main'
        ? models.diffusionModel
        : models.loras.find((item) => item.ref === expected.ref);
  if (
    !existing ||
    existing.modelId !== expected.modelId ||
    existing.versionId !== expected.versionId ||
    existing.fileId !== expected.fileId
  )
    throw new BusinessError('REVISION_CONFLICT', 'Model selection identity changed.');
  const replacement = { ...next, ref: expected.ref };
  if (expected.ref === 'checkpoint.main')
    return { ...models, checkpoint: { ...replacement, ref: 'checkpoint.main' } };
  if (expected.ref === 'diffusion_model.main')
    return { ...models, diffusionModel: { ...replacement, ref: 'diffusion_model.main' } };
  return {
    ...models,
    loras: models.loras.map((item) => (item.ref === expected.ref ? replacement : item)),
  };
}

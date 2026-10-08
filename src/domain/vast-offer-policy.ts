import type {
  VastAiOfferSearchInput,
  VastAiComfyUiTemplate,
  VastAiRentRequest,
  VastAiOffer,
} from './integration-types.js';
function numberValue(value: unknown) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
function integerValue(value: unknown) {
  const n = numberValue(value);
  return n !== null && Number.isInteger(n) ? n : null;
}
function normalizedCountryCodes(values: unknown) {
  if (!Array.isArray(values)) return [] as string[];
  const result: string[] = [];
  for (const value of values) {
    const code = String(value ?? '')
      .trim()
      .toUpperCase();
    if (!code) continue;
    if (!/^[A-Z]{2}$/.test(code))
      throw new Error(`除外地域は2文字の国コードで指定してください: ${code}`);
    if (!result.includes(code)) result.push(code);
  }
  return result;
}

export function normalizeOfferSearchInput(
  input: VastAiOfferSearchInput,
  template: VastAiComfyUiTemplate,
) {
  const storageGb = numberValue(input?.storageGb),
    minTflops = numberValue(input?.minTflops),
    gpuCount = integerValue(input?.gpuCount),
    minReliability = numberValue(input?.minReliability),
    excludedCountries = normalizedCountryCodes(input?.excludedCountries);
  if (storageGb == null || storageGb <= 0)
    throw new Error('Storageは0より大きいGB値を指定してください。');
  if (storageGb < template.recommendedDiskSpaceGb)
    throw new Error(
      `ComfyUI Templateの推奨Storageは ${template.recommendedDiskSpaceGb} GB以上です。`,
    );
  if (minTflops == null || minTflops < 0)
    throw new Error('Minimum TFLOPsは0以上で指定してください。');
  if (gpuCount == null || gpuCount < 1 || gpuCount > 64)
    throw new Error('GPU Countは1〜64の整数で指定してください。');
  if (minReliability == null || minReliability < 0 || minReliability > 100)
    throw new Error('Reliabilityは0〜100%で指定してください。');
  return { storageGb, minTflops, gpuCount, minReliability, excludedCountries };
}

export function normalizeRentRequest(input: VastAiRentRequest) {
  if (!input || typeof input !== 'object') throw new Error('Invalid Vast.ai RENT request');
  const offerId = Number(input.offerId),
    storageGb = Number(input.storageGb),
    templateHashId = typeof input.templateHashId === 'string' ? input.templateHashId.trim() : '';
  if (
    !Number.isInteger(offerId) ||
    offerId < 1 ||
    !Number.isFinite(storageGb) ||
    storageGb <= 0 ||
    !templateHashId
  )
    throw new Error('Invalid Vast.ai RENT request');
  return { offerId, storageGb, templateHashId };
}
export function assertRentCapacity(input: VastAiRentRequest, template: VastAiComfyUiTemplate) {
  if (input.templateHashId !== template.hashId)
    throw new Error('ComfyUI Template identity mismatch.');
  if (input.storageGb < template.recommendedDiskSpaceGb)
    throw new Error(
      'ComfyUI Templateの推奨Storageは ' + template.recommendedDiskSpaceGb + ' GB以上です。',
    );
}
export function rankTemplates(templates: VastAiComfyUiTemplate[]) {
  return [...templates].sort(
    (a, b) =>
      (b.countCreated ?? 0) - (a.countCreated ?? 0) ||
      b.recommendedDiskSpaceGb - a.recommendedDiskSpaceGb,
  );
}
export function rankOffers(offers: VastAiOffer[]) {
  return [...offers].sort(
    (a, b) =>
      (a.hourlyCost ?? Number.POSITIVE_INFINITY) - (b.hourlyCost ?? Number.POSITIVE_INFINITY) ||
      a.id - b.id,
  );
}

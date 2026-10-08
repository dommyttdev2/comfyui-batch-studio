import type {
  VastAiComfyUiTemplate,
  VastAiOffer,
  VastAiOfferSearchInput,
  VastAiRentRequest,
} from '../domain/integration-types.js';
import {
  normalizeOfferSearchInput,
  normalizeRentRequest,
  assertRentCapacity,
  rankTemplates,
  rankOffers,
} from '../domain/vast-offer-policy.js';
export interface VastOfferPorts {
  templates(hashId?: string): Promise<VastAiComfyUiTemplate[]>;
  offers(criteria: Record<string, unknown>): Promise<VastAiOffer[]>;
  rent(offerId: number, templateHashId: string, disk: number): Promise<number>;
  rememberCreated(instanceId: number, offer: VastAiOffer): void;
}
export class VastOfferUseCases {
  constructor(private readonly ports: VastOfferPorts) {}
  async template(hashId?: string) {
    const values = rankTemplates(await this.ports.templates(hashId));
    if (!values.length)
      throw new Error(
        hashId
          ? '指定したVast.ai ComfyUI Templateが利用できません。'
          : 'Vast.aiの推奨ComfyUI Template（SSH Direct対応）が見つかりません。',
      );
    const selected = values[0];
    if (hashId && selected.hashId !== hashId)
      throw new Error('ComfyUI Template identity mismatch.');
    return selected;
  }
  async search(input: VastAiOfferSearchInput) {
    const template = await this.template(),
      search = normalizeOfferSearchInput(input, template);
    const criteria: Record<string, unknown> = {
      ...template.extraFilters,
      limit: 100,
      type: 'on-demand',
      verified: { eq: true },
      rentable: { eq: true },
      rented: { eq: false },
      duration: { gte: 7 * 24 * 60 * 60 },
      allocated_storage: search.storageGb,
      num_gpus: { eq: search.gpuCount },
      reliability: { gte: search.minReliability / 100 },
      order: [['dph_total', 'asc']],
    };
    if (search.minTflops > 0) criteria.total_flops = { gte: search.minTflops };
    if (search.excludedCountries.length) criteria.geolocation = { notin: search.excludedCountries };
    return { template, offers: rankOffers(await this.ports.offers(criteria)) };
  }
  async offer(offerId: number, storageGb: number) {
    if (!Number.isInteger(offerId) || offerId < 1) throw new Error('Vast.ai Offer IDが不正です。');
    if (!Number.isFinite(storageGb) || storageGb <= 0) throw new Error('Storageが不正です。');
    const offers = await this.ports.offers({
      limit: 1,
      type: 'on-demand',
      rentable: { eq: true },
      rented: { eq: false },
      id: { eq: offerId },
      allocated_storage: storageGb,
    });
    if (!offers.length)
      throw new Error(
        'Vast.ai Offer #' + offerId + ' は現在RENTできません。検索結果を更新してください。',
      );
    if (offers[0].id !== offerId) throw new Error('Vast.ai Offer identity mismatch.');
    return offers[0];
  }
  async prepareRent(value: VastAiRentRequest) {
    const input = normalizeRentRequest(value),
      [offer, template] = await Promise.all([
        this.offer(input.offerId, input.storageGb),
        this.template(input.templateHashId),
      ]);
    assertRentCapacity(input, template);
    return { input, offer, template };
  }
  async rent(value: VastAiRentRequest, validatedOffer?: VastAiOffer) {
    const input = normalizeRentRequest(value),
      template = await this.template(input.templateHashId);
    assertRentCapacity(input, template);
    const offer = validatedOffer ?? (await this.offer(input.offerId, input.storageGb));
    if (offer.id !== input.offerId) throw new Error('Vast.ai Offer identity mismatch.');
    const id = await this.ports.rent(input.offerId, template.hashId, input.storageGb);
    this.ports.rememberCreated(id, offer);
    return id;
  }
  async confirmAndRent(
    value: VastAiRentRequest,
    confirm: (facts: Awaited<ReturnType<VastOfferUseCases['prepareRent']>>) => Promise<boolean>,
  ) {
    const facts = await this.prepareRent(value);
    if (!(await confirm(facts))) return null;
    const current = await this.prepareRent(facts.input);
    if (JSON.stringify(current) !== JSON.stringify(facts))
      throw new Error('Vast.ai RENT target changed after confirmation.');
    return this.rent(current.input, current.offer);
  }
}

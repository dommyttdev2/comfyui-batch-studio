import type {
  CatalogSelectionTemplateInput,
  CivitaiConnectionInput,
  VastAiConnectionInput,
  VastAiOfferSearchInput,
  VastAiRentRequest,
  VastAiSshEndpoint,
} from '../../shared/types.js';
import type { IpcRegistrationDependencies } from '../ipc-registration.js';

export function registerIntegrationIpc(dependencies: IpcRegistrationDependencies) {
  const {
    IPC,
    VastAiClient,
    catalogService,
    catalogStatus,
    civitaiStore,
    dialog,
    handleIpc,
    integratedCatalogStatus,
    reloadCivitaiCatalog,
    resolveVastSshEndpoint,
    scanProject,
    shell,
    validCivitaiUrl,
    validInstanceId,
    vastClient,
    vastStore,
  } = dependencies;
  const validRoot: IpcRegistrationDependencies['validRoot'] = dependencies.validRoot;

  handleIpc(IPC.CATALOG_STATUS, (_e, root: unknown) => {
    validRoot(root);
    return catalogStatus(root);
  });
  handleIpc(IPC.CATALOG_INTEGRATED_STATUS, () => integratedCatalogStatus());
  handleIpc(IPC.CATALOG_INTEGRATED_SNAPSHOT, () => catalogService().catalog());
  handleIpc(IPC.CATALOG_INTEGRATED_SYNC, async () => {
    await catalogService().startSync();
    return integratedCatalogStatus();
  });
  handleIpc(IPC.CATALOG_LINK_PROJECT, async (_e, root: unknown) => {
    validRoot(root);
    return scanProject(root);
  });
  handleIpc(IPC.CATALOG_TEMPLATES, () => catalogService().templates());
  handleIpc(IPC.CATALOG_SAVE_TEMPLATE, (_e, input: CatalogSelectionTemplateInput) =>
    catalogService().saveTemplate(input),
  );
  handleIpc(IPC.CATALOG_DELETE_TEMPLATE, (_e, id: unknown) => {
    if (typeof id !== 'string' || !id) throw new Error('Invalid template id');
    return catalogService().deleteTemplate(id);
  });
  handleIpc(IPC.CATALOG_OPEN_MODEL, async (_e, url: unknown) => {
    if (!validCivitaiUrl(url)) throw new Error('Civitai URLが不正です。');
    await shell.openExternal(url as string);
  });
  handleIpc(IPC.CIVITAI_SETTINGS, () => civitaiStore().status());
  handleIpc(IPC.CIVITAI_SAVE_SETTINGS, async (_e, input: CivitaiConnectionInput) => {
    const result = await civitaiStore().save(input);
    const service = await reloadCivitaiCatalog();
    const initial = service.status();
    if (initial.state === 'idle' && initial.apiKeyConfigured) void service.startSync();
    return result;
  });
  handleIpc(IPC.VASTAI_SETTINGS, () => vastStore().status());
  handleIpc(IPC.VASTAI_SAVE_SETTINGS, (_e, input: VastAiConnectionInput) =>
    vastStore().save(input),
  );
  handleIpc(IPC.VASTAI_TEST, async (_e, input: VastAiConnectionInput | undefined) => {
    const override = typeof input?.apiKey === 'string' ? input.apiKey.trim() : '';
    if (override) {
      const client = new VastAiClient(async () => override);
      await client.testConnection();
      return;
    }
    await vastClient().testConnection();
  });
  handleIpc(IPC.VASTAI_SELECT_PRIVATE_KEY, async () => {
    const r = await dialog.showOpenDialog({
      title: 'Vast.ai SSH秘密鍵を選択',
      properties: ['openFile'],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  handleIpc(IPC.VASTAI_SELECT_PUBLIC_KEY, async () => {
    const r = await dialog.showOpenDialog({
      title: 'Vast.ai SSH公開鍵を選択',
      properties: ['openFile'],
      filters: [
        { name: 'SSH Public Key', extensions: ['pub'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  handleIpc(IPC.VASTAI_INSTANCES, () => vastClient().listInstances());
  handleIpc(IPC.VASTAI_COMFYUI_TEMPLATE, () => vastClient().comfyUiTemplate());
  handleIpc(IPC.VASTAI_SEARCH_OFFERS, (_e, input: VastAiOfferSearchInput) =>
    vastClient().searchOffers(input),
  );
  handleIpc(IPC.VASTAI_RENT_OFFER, async (_e, input: VastAiRentRequest) => {
    return vastClient()
      .offerUseCases()
      .confirmAndRent(input, async ({ offer, template, input: { storageGb } }) => {
        const gpu = `${offer.gpuCount ?? '-'}x ${offer.gpuName ?? 'GPU'}`;
        const cost = offer.hourlyCost == null ? '不明' : '$' + offer.hourlyCost.toFixed(3) + '/h';
        const reliability =
          offer.reliability == null ? '不明' : (offer.reliability * 100).toFixed(2) + '%';
        const result = await dialog.showMessageBox({
          type: 'question',
          title: 'Vast.aiでRENT',
          message: `${gpu} をRENTしますか？`,
          detail: `On-demand · ${offer.geolocation ?? 'Location不明'}\n料金: ${cost}\nStorage: ${storageGb} GB\nReliability: ${reliability}\nTemplate: ${template.name}\n\nRENTするとVast.aiで課金が開始されます。`,
          buttons: ['キャンセル', 'RENT'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        return result.response === 1;
      });
  });
  handleIpc(IPC.VASTAI_START_INSTANCE, async (_e, id: unknown) => {
    await vastClient().requestStartInstance(validInstanceId(id));
  });
  handleIpc(IPC.VASTAI_STOP_INSTANCE, async (_e, id: unknown) => {
    await vastClient().requestStopInstance(validInstanceId(id));
  });
  handleIpc(IPC.VASTAI_DESTROY_INSTANCE, async (_e, id: unknown) => {
    const instanceId = validInstanceId(id);
    const result = await dialog.showMessageBox({
      type: 'warning',
      title: 'Vast.ai Instanceを削除',
      message: `Instance #${instanceId} を削除しますか？`,
      detail: 'この操作は取り消せません。Instance上のデータも削除されます。',
      buttons: ['キャンセル', '削除'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (result.response !== 1) return false;
    await vastClient().destroyInstance(instanceId);
    return true;
  });
  handleIpc(IPC.VASTAI_REBOOT_INSTANCE, async (_e, id: unknown) => {
    await vastClient().requestRebootInstance(validInstanceId(id));
  });
  handleIpc(
    IPC.VASTAI_RESOLVE_SSH,
    async (_e, id: unknown): Promise<VastAiSshEndpoint> =>
      resolveVastSshEndpoint(validInstanceId(id)),
  );
}

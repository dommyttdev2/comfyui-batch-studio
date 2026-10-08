export interface VastAiComfyUiTemplate {
  id: number | null;
  hashId: string;
  name: string;
  recommendedDiskSpaceGb: number;
  countCreated: number | null;
  extraFilters: Record<string, unknown>;
}
export interface VastAiOfferSearchInput {
  storageGb: number;
  minTflops: number;
  gpuCount: number;
  minReliability: number;
  excludedCountries: string[];
}
export interface VastAiOffer {
  id: number;
  gpuName: string | null;
  gpuCount: number | null;
  gpuRamMb: number | null;
  gpuTotalRamMb: number | null;
  totalFlops: number | null;
  gpuMemBandwidthGbps: number | null;
  verification: string | null;
  geolocation: string | null;
  machineId: number | null;
  hostId: number | null;
  motherboard: string | null;
  pciGen: number | null;
  gpuLanes: number | null;
  pcieBandwidthGbps: number | null;
  cpuName: string | null;
  cpuCores: number | null;
  cpuCoresEffective: number | null;
  cpuRamMb: number | null;
  diskName: string | null;
  diskBandwidthMb: number | null;
  diskSpaceGb: number | null;
  internetDownMb: number | null;
  internetUpMb: number | null;
  directPortCount: number | null;
  dlperf: number | null;
  cudaMaxGood: number | null;
  durationSeconds: number | null;
  reliability: number | null;
  dlperfPerDollar: number | null;
  flopsPerDollar: number | null;
  hourlyCost: number | null;
  storageCostPerGbMonth: number | null;
  internetDownCostPerTb: number | null;
  internetUpCostPerTb: number | null;
}
export interface VastAiOfferSearchResult {
  template: VastAiComfyUiTemplate;
  offers: VastAiOffer[];
}
export interface VastAiRentRequest {
  offerId: number;
  storageGb: number;
  templateHashId: string;
}

export interface CatalogSelectionEntry {
  collectionId: number;
  modelId: number;
  versionId: number;
}
export interface CatalogSelectionTemplate {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  selection: CatalogSelectionEntry[];
}
export interface CatalogSelectionTemplateInput {
  id?: string;
  name: string;
  selection: CatalogSelectionEntry[];
}

export interface R2BatchDownloadTemplate {
  id: string;
  name: string;
  bucket: string;
  createdAt: string;
  updatedAt: string;
  objects: Array<{ key: string; name: string; size?: number }>;
}
export interface R2UploadSourceFingerprint {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  dev: number;
  ino: number;
  sha256: string;
  partSha256: string[];
}
export interface R2UploadJob {
  id: string;
  sourceFingerprint?: R2UploadSourceFingerprint;
  hashProgressBytes?: number;
  kind?: 'upload' | 'move';
  startedAt?: string;
  initialTransferredBytes?: number;
  completedAt?: string;
  bucket: string;
  key: string;
  filePath: string;
  fileName: string;
  size: number;
  contentType: string;
  uploadId: string | null;
  partSize: number;
  completedParts: Record<string, string>;
  status: 'paused' | 'uploading' | 'complete' | 'failed' | 'cancelled';
  transferredBytes: number;
  error: string;
  createdAt: string;
}

export interface VastAiSshEndpoint {
  provider: 'vastai';
  instanceId: number;
  host: string;
  port: number;
  user: string;
  privateKeyPath: string;
  publicKeyPath: string;
  comfyUiDirectory: string;
  comfyUiPort: number;
}

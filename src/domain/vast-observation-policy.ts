import type { CloudInstanceStatus, VastAiInstance } from './artifact-types.js';
import type { VastAiComfyUiTemplate, VastAiOffer } from './integration-types.js';

type JsonRecord = Record<string, unknown>;
function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
}
function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function numberValue(value: unknown) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
function integerValue(value: unknown) {
  const n = numberValue(value);
  return n != null && Number.isInteger(n) ? n : null;
}
function rawStatusOf(payload: JsonRecord) {
  return (
    String(payload.actual_status ?? payload.status ?? 'unknown')
      .trim()
      .toLowerCase() || 'unknown'
  );
}
function objectValue(value: unknown): JsonRecord {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as JsonRecord;
  if (typeof value === 'string' && value.trim()) {
    try {
      return record(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return {};
}

export function normalizeVastStatus(payload: unknown): CloudInstanceStatus {
  const item = record(payload),
    raw = rawStatusOf(item),
    intended = String(item.intended_status ?? '').toLowerCase(),
    cur = String(item.cur_state ?? '').toLowerCase(),
    next = String(item.next_state ?? '').toLowerCase(),
    message = String(item.status_msg ?? '')
      .trim()
      .toLowerCase();
  if (raw === 'scheduling') return 'scheduling';
  const runningLike = raw === 'running';
  const stoppingByIntent = runningLike && (intended === 'stopped' || next === 'stopped');
  const stoppingByMessage =
    runningLike &&
    /(^|[ ,:;])stopp(?:ed|ing)([ ,:;]|$)/.test(message) &&
    intended !== 'running' &&
    next !== 'running';
  if (stoppingByIntent || stoppingByMessage) return 'stopping';
  if (raw === 'running') return 'running';
  const stoppedLike = raw === 'stopped' || raw === 'exited';
  const schedulingByIntent = stoppedLike && (intended === 'running' || next === 'running');
  const schedulingByMessage =
    stoppedLike && /(^|[ ,:;])running([ ,:;]|$)/.test(message) && next !== 'stopped';
  if (schedulingByIntent || schedulingByMessage) return 'scheduling';
  if (raw === 'stopped' || (raw === 'exited' && intended === 'stopped' && cur === 'stopped'))
    return 'stopped';
  if (['loading', 'starting', 'rebooting', 'restarting', 'creating', 'connecting'].includes(raw))
    return 'starting';
  if (['stopping', 'destroying'].includes(raw)) return 'stopping';
  if (['offline', 'unavailable'].includes(raw)) return 'offline';
  if (['error', 'failed', 'failure'].includes(raw)) return 'error';
  return 'unknown';
}

function mappedTcpEndpoint(payload: JsonRecord, internalPort: number) {
  const ports = record(payload.ports),
    mappings = ports[`${internalPort}/tcp`];
  if (!Array.isArray(mappings)) return null;
  const publicHost = stringValue(payload.public_ipaddr);
  for (const candidate of mappings) {
    const mapping = record(candidate),
      host = publicHost ?? stringValue(mapping.HostIp),
      port = integerValue(mapping.HostPort);
    if (host && host !== '0.0.0.0' && host !== '::' && port && port > 0)
      return { host, port, internalPort };
  }
  return null;
}
export function normalizeComfyUiTemplate(payload: unknown): VastAiComfyUiTemplate {
  const item = record(payload),
    hashId = stringValue(item.hash_id),
    name = stringValue(item.name);
  if (!hashId || !name) throw new Error('Vast.ai ComfyUI Template応答が不正です。');
  return {
    id: integerValue(item.id),
    hashId,
    name,
    recommendedDiskSpaceGb: numberValue(item.recommended_disk_space) ?? 8,
    countCreated: integerValue(item.count_created),
    extraFilters: objectValue(item.extra_filters),
  };
}
export function normalizeVastOffer(payload: unknown): VastAiOffer {
  const item = record(payload),
    id = integerValue(item.id) ?? integerValue(item.ask_contract_id);
  if (id == null || id < 1) throw new Error('Vast.ai Offer応答に有効なIDがありません。');
  return {
    id,
    gpuName: stringValue(item.gpu_name),
    gpuCount: integerValue(item.num_gpus),
    gpuRamMb: numberValue(item.gpu_ram),
    gpuTotalRamMb: numberValue(item.gpu_total_ram),
    totalFlops: numberValue(item.total_flops),
    gpuMemBandwidthGbps: numberValue(item.gpu_mem_bw),
    verification: stringValue(item.verification),
    geolocation: stringValue(item.geolocation),
    machineId: integerValue(item.machine_id),
    hostId: integerValue(item.host_id),
    motherboard: stringValue(item.mobo_name),
    pciGen: numberValue(item.pci_gen),
    gpuLanes: integerValue(item.gpu_lanes),
    pcieBandwidthGbps: numberValue(item.pcie_bw),
    cpuName: stringValue(item.cpu_name),
    cpuCores: integerValue(item.cpu_cores),
    cpuCoresEffective: numberValue(item.cpu_cores_effective),
    cpuRamMb: numberValue(item.cpu_ram),
    diskName: stringValue(item.disk_name),
    diskBandwidthMb: numberValue(item.disk_bw),
    diskSpaceGb: numberValue(item.disk_space),
    internetDownMb: numberValue(item.inet_down),
    internetUpMb: numberValue(item.inet_up),
    directPortCount: integerValue(item.direct_port_count),
    dlperf: numberValue(item.dlperf),
    cudaMaxGood: numberValue(item.cuda_max_good),
    durationSeconds: numberValue(item.duration),
    reliability: numberValue(item.reliability),
    dlperfPerDollar: numberValue(item.dlperf_per_dphtotal),
    flopsPerDollar: numberValue(item.flops_per_dphtotal),
    hourlyCost: numberValue(item.dph_total),
    storageCostPerGbMonth: numberValue(item.storage_cost),
    internetDownCostPerTb: numberValue(item.internet_down_cost_per_tb),
    internetUpCostPerTb: numberValue(item.internet_up_cost_per_tb),
  };
}
function publicSshEndpoint(payload: JsonRecord) {
  return mappedTcpEndpoint(payload, 22);
}
export function resolveVastComfyUiPort(payload: unknown) {
  const ports = record(record(payload).ports);
  for (const internalPort of [18188, 8188]) {
    const mappings = ports[`${internalPort}/tcp`];
    if (
      Array.isArray(mappings) &&
      mappings.some((candidate) => {
        const port = integerValue(record(candidate).HostPort);
        return port != null && port > 0;
      })
    )
      return internalPort;
  }
  return null;
}

export function normalizeVastInstance(payload: unknown): VastAiInstance {
  const item = record(payload),
    id = integerValue(item.id);
  if (id == null || id < 1) throw new Error('Vast.ai Instance応答に有効なIDがありません。');
  const status = normalizeVastStatus(item),
    mapped = status === 'running' ? publicSshEndpoint(item) : null;
  const sshHost =
      status === 'running'
        ? (mapped?.host ?? stringValue(item.ssh_host) ?? stringValue(item.public_ipaddr))
        : null,
    sshPort = status === 'running' ? (mapped?.port ?? integerValue(item.ssh_port) ?? null) : null,
    comfyUiPort = status === 'running' ? resolveVastComfyUiPort(item) : null;
  return {
    provider: 'vastai',
    id,
    label: stringValue(item.label),
    status,
    rawStatus: rawStatusOf(item),
    intendedStatus: stringValue(item.intended_status),
    curState: stringValue(item.cur_state),
    nextState: stringValue(item.next_state),
    statusMessage: stringValue(item.status_msg),
    gpuName: stringValue(item.gpu_name),
    gpuCount: integerValue(item.num_gpus),
    gpuRamMb: integerValue(item.gpu_ram) ?? integerValue(item.gpu_totalram),
    hourlyCost: numberValue(item.dph_total),
    sshHost,
    sshPort,
    comfyUiPort,
  };
}

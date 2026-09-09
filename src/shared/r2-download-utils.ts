export interface DownloadUrlLike { url:string }

export function shellQuote(value:string){
  return `'${String(value).replaceAll("'", `'\"'\"'`)}'`;
}

export function normalizeAria2Connections(value:unknown){
  const parsed=Number.parseInt(String(value),10);
  if(!Number.isFinite(parsed)) return 3;
  return Math.min(16,Math.max(1,parsed));
}

export function normalizeAria2ConcurrentDownloads(value:unknown){
  const parsed=Number.parseInt(String(value),10);
  if(!Number.isFinite(parsed)) return 3;
  return Math.min(16,Math.max(1,parsed));
}

export function buildAria2Command(downloads:DownloadUrlLike[],connections=3,concurrentDownloads=3){
  if(!Array.isArray(downloads)||downloads.length===0) return '';
  const urls=downloads.map(item=>shellQuote(item.url)).join(' ');
  const separate=downloads.length>1?' -Z':'';
  return `aria2c --allow-overwrite=false --auto-file-renaming=false -j${normalizeAria2ConcurrentDownloads(concurrentDownloads)} -x${normalizeAria2Connections(connections)}${separate} ${urls}`;
}

export function formatBatchTotalSize(bytes:number){
  const normalized=Number(bytes);
  if(!Number.isFinite(normalized)||normalized<=0) return '0 MB';
  const useGigabytes=normalized>=1024**3;
  const value=normalized/(1024**(useGigabytes?3:2));
  return `${value.toFixed(value>=10?1:2)} ${useGigabytes?'GB':'MB'}`;
}

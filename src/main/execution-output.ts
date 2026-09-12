export function executionArchiveTimestampJst(value:string|Date){
  const source=value instanceof Date?value:new Date(value);
  if(Number.isNaN(source.getTime()))throw new Error('Invalid archive timestamp.');
  const jst=new Date(source.getTime()+9*60*60*1000);
  const iso=jst.toISOString();
  return iso.slice(0,10).replaceAll('-','')+'_'+iso.slice(11,19).replaceAll(':','');
}

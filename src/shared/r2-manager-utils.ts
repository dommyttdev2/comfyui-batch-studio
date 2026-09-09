export const MAX_R2_OBJECT_KEY_BYTES = 1024;
export const MAX_BATCH_TEMPLATE_OBJECTS = 500;
export const MAX_BATCH_TEMPLATES_PER_BUCKET = 100;
export const MAX_BATCH_TEMPLATE_NAME_LENGTH = 100;

export interface NormalizedTemplateObject {
  key:string;
  name:string;
  size?:number;
}

export function objectName(key:string){
  return key.split('/').pop() || 'download';
}

export function normalizeR2ObjectKey(raw:string){
  let value=String(raw??'').trim().replaceAll('\\','/');
  value=value.replace(/^\/+/, '').replace(/\/{2,}/g,'/');
  if(!value || value.endsWith('/')) throw new Error('移動先にはファイル名まで入力してください。');
  const segments=value.split('/');
  if(segments.some(segment=>!segment||segment==='.'||segment==='..')){
    throw new Error('移動先のパスに空の区切り、.、.. は使用できません。');
  }
  if(new TextEncoder().encode(value).length>MAX_R2_OBJECT_KEY_BYTES){
    throw new Error('移動先のパスが1,024バイトを超えています。');
  }
  return value;
}

export function normalizeBatchTemplateName(raw:string){
  const value=String(raw??'').trim();
  if(!value) throw new Error('テンプレート名を入力してください。');
  if(value.length>MAX_BATCH_TEMPLATE_NAME_LENGTH) throw new Error('テンプレート名は100文字以内で入力してください。');
  if([...value].some(character=>character.charCodeAt(0)<32)) throw new Error('テンプレート名に改行や制御文字は使用できません。');
  return value;
}

export function normalizeBatchTemplateObjects(raw:unknown):NormalizedTemplateObject[]{
  if(!Array.isArray(raw)||raw.length===0) throw new Error('テンプレートに保存するファイルを選択してください。');
  if(raw.length>MAX_BATCH_TEMPLATE_OBJECTS) throw new Error('テンプレートに保存できるファイルは500件までです。');
  const seen=new Set<string>();
  const normalized:NormalizedTemplateObject[]=[];
  for(const entry of raw){
    if(!entry||typeof entry!=='object'||Array.isArray(entry)) throw new Error('テンプレートのファイル情報が正しくありません。');
    const item=entry as Record<string,unknown>;
    const key=String(item.key??'');
    if(!key||seen.has(key)||new TextEncoder().encode(key).length>MAX_R2_OBJECT_KEY_BYTES){
      throw new Error('テンプレートのObject Keyが正しくありません。');
    }
    seen.add(key);
    const numericSize=Number(item.size??0);
    if(!Number.isFinite(numericSize)||numericSize<0) throw new Error('テンプレートのファイルサイズが正しくありません。');
    normalized.push({key,name:objectName(key),size:numericSize});
  }
  return normalized;
}

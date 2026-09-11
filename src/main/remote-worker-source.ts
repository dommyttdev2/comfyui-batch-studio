export const REMOTE_WORKER_VERSION='2';
export const REMOTE_WORKER_FILE=`#!/usr/bin/env python3
import hashlib,json,os,sys,urllib.error,urllib.parse,urllib.request
VERSION="2"
CHUNK_SIZE=8*1024*1024

class WorkerError(Exception):
 def __init__(self,code,message=None):
  super().__init__(message or code); self.code=code

def emit(kind, **data):
 print(json.dumps({"type":kind,**data},separators=(",",":")),flush=True)

def contained(root,value):
 root=os.path.realpath(root); candidate=os.path.abspath(os.path.join(root,value))
 parent=os.path.realpath(os.path.dirname(candidate))
 if os.path.commonpath([root,parent]) != root: raise WorkerError("PATH_OUTSIDE_ALLOWED_ROOT")
 if os.path.lexists(candidate) and os.path.realpath(candidate) != candidate: raise WorkerError("SYMLINK_ESCAPE_REJECTED")
 real=os.path.realpath(candidate)
 if os.path.commonpath([root,real]) != root: raise WorkerError("PATH_OUTSIDE_ALLOWED_ROOT")
 return real

def model_path(model_root,value):
 if not os.path.isdir(model_root): raise WorkerError("MODEL_ROOT_MISSING","Remote ComfyUI models directory does not exist.")
 raw=str(value or "").replace("\\\\","/").lstrip("/")
 if not raw or raw.startswith("../") or "/../" in raw or raw=="..": raise WorkerError("MODEL_PATH_INVALID")
 return contained(model_root,raw)

def sha256_file(target):
 h=hashlib.sha256()
 with open(target,"rb") as f:
  while True:
   chunk=f.read(CHUNK_SIZE)
   if not chunk: break
   h.update(chunk)
 return h.hexdigest()

def inspect_model(model_root,req):
 target=model_path(model_root,req.get("path"))
 expected_size=int(req.get("expectedSize",-1))
 expected_sha=str(req.get("expectedSha256") or "").lower()
 if not os.path.exists(target): return {"exists":False,"valid":False,"size":0,"sha256":None,"reason":"missing"}
 if not os.path.isfile(target): return {"exists":True,"valid":False,"size":0,"sha256":None,"reason":"not_file"}
 size=os.path.getsize(target)
 if expected_size>=0 and size!=expected_size: return {"exists":True,"valid":False,"size":size,"sha256":None,"reason":"size_mismatch"}
 digest=sha256_file(target) if expected_sha or bool(req.get("computeSha256")) else None
 if expected_sha and digest!=expected_sha: return {"exists":True,"valid":False,"size":size,"sha256":digest,"reason":"sha256_mismatch"}
 return {"exists":True,"valid":True,"size":size,"sha256":digest,"reason":"valid"}

def download_model(model_root,req):
 target=model_path(model_root,req.get("path"))
 expected_size=int(req.get("expectedSize",-1))
 expected_sha=str(req.get("expectedSha256") or "").lower()
 url=str(req.get("url") or "")
 parsed=urllib.parse.urlparse(url)
 if parsed.scheme not in ("http","https") or not parsed.netloc: raise WorkerError("MODEL_DOWNLOAD_URL_INVALID")
 existing=inspect_model(model_root,{**req,"computeSha256":True})
 if existing.get("valid"): return {**existing,"reused":True}
 if os.path.lexists(target):
  if os.path.isdir(target) and not os.path.islink(target): raise WorkerError("MODEL_DESTINATION_IS_DIRECTORY")
  os.unlink(target)
 parent=os.path.dirname(target); os.makedirs(parent,exist_ok=True)
 target=model_path(model_root,req.get("path"))
 part=target+".part"
 if os.path.lexists(part):
  if os.path.isdir(part) and not os.path.islink(part): raise WorkerError("MODEL_PART_IS_DIRECTORY")
  os.unlink(part)
 transferred=0; digest=hashlib.sha256()
 try:
  request=urllib.request.Request(url,headers={"User-Agent":"ComfyUI-Batch-Studio-Remote-Worker/"+VERSION})
  with urllib.request.urlopen(request,timeout=60) as response, open(part,"wb") as out:
   status=int(getattr(response,"status",200) or 200)
   if status<200 or status>=300: raise WorkerError("MODEL_DOWNLOAD_HTTP_"+str(status))
   while True:
    chunk=response.read(CHUNK_SIZE)
    if not chunk: break
    out.write(chunk); digest.update(chunk); transferred+=len(chunk)
    emit("progress",stage="model_downloading",transferredBytes=transferred,totalBytes=expected_size)
   out.flush(); os.fsync(out.fileno())
 except urllib.error.HTTPError as e:
  raise WorkerError("MODEL_DOWNLOAD_HTTP_"+str(e.code),"Remote model download returned HTTP "+str(e.code)+".")
 except urllib.error.URLError:
  raise WorkerError("MODEL_DOWNLOAD_NETWORK","Remote model download failed due to a network error.")
 except TimeoutError:
  raise WorkerError("MODEL_DOWNLOAD_TIMEOUT","Remote model download timed out.")
 size=os.path.getsize(part)
 actual_sha=digest.hexdigest()
 if expected_size>=0 and size!=expected_size:
  os.unlink(part); raise WorkerError("MODEL_SIZE_MISMATCH",f"Expected {expected_size} bytes but downloaded {size} bytes.")
 if expected_sha and actual_sha!=expected_sha:
  os.unlink(part); raise WorkerError("MODEL_SHA256_MISMATCH","Downloaded model SHA-256 does not match expected value.")
 os.replace(part,target)
 emit("progress",stage="model_ready",transferredBytes=size,totalBytes=expected_size)
 return {"exists":True,"valid":True,"size":size,"sha256":actual_sha,"reason":"downloaded","reused":False}

def handle(req,root,model_root):
 op=req.get("op")
 if op=="health": return {"ok":True,"version":VERSION,"pid":os.getpid()}
 if op=="status":
  state=contained(root,"state.json")
  return {"ok":True,"state":json.load(open(state,encoding="utf-8")) if os.path.exists(state) else None}
 if op=="write_state":
  state=contained(root,"state.json"); tmp=state+".tmp"
  with open(tmp,"w",encoding="utf-8") as f: json.dump(req.get("state"),f,separators=(",",":"))
  os.replace(tmp,state); emit("progress",stage="state_saved"); return {"ok":True}
 if op=="resolve_path": return {"ok":True,"path":contained(root,str(req.get("path","")))}
 if op=="model_environment":
  if not model_root: raise WorkerError("MODEL_ROOT_NOT_CONFIGURED")
  if not os.path.isdir(model_root): raise WorkerError("MODEL_ROOT_MISSING","Remote ComfyUI models directory does not exist.")
  return {"ok":True,"modelsRoot":os.path.realpath(model_root)}
 if op=="inspect_model":
  if not model_root: raise WorkerError("MODEL_ROOT_NOT_CONFIGURED")
  return inspect_model(model_root,req)
 if op=="stage_model":
  if not model_root: raise WorkerError("MODEL_ROOT_NOT_CONFIGURED")
  return download_model(model_root,req)
 raise WorkerError("UNSUPPORTED_OPERATION")

def main():
 root=os.path.realpath(sys.argv[sys.argv.index("--root")+1]); os.makedirs(root,exist_ok=True)
 model_root=None
 if "--model-root" in sys.argv: model_root=os.path.realpath(sys.argv[sys.argv.index("--model-root")+1])
 line=sys.stdin.readline(); req=json.loads(line); rid=req.get("requestId")
 try: emit("response",requestId=rid,result=handle(req,root,model_root))
 except Exception as e:
  code=getattr(e,"code",str(e)); emit("response",requestId=rid,error={"code":str(code),"message":str(e)}); sys.exit(2)
if __name__=="__main__": main()
`;

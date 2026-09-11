export const REMOTE_WORKER_VERSION='6';
export const REMOTE_WORKER_FILE=`#!/usr/bin/env python3
import base64,hashlib,json,os,re,shutil,subprocess,sys,tempfile,time,urllib.parse,urllib.request
VERSION="6"
CHUNK_SIZE=8*1024*1024
REPO_RE=re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")

class WorkerError(Exception):
 def __init__(self,code,message=None):
  super().__init__(message or code); self.code=code

def emit(kind, **data):
 print(json.dumps({"type":kind,**data},separators=(",",":")),flush=True)

def redact(value):
 text=str(value or "")
 text=re.sub(r"https?://\\S+","[url]",text)
 text=re.sub(r"(?i)(github_pat_|ghp_)[A-Za-z0-9_]+","[token]",text)
 text=re.sub(r"(?i)([?&](?:X-Amz-[^=]+|Signature|sig|token)=)[^&\\s]+",r"\\1[redacted]",text)
 return text[:4000]

def run_cmd(args,cwd=None,env=None,input_text=None,error_code="REMOTE_COMMAND_FAILED",allow_failure=False):
 try:
  result=subprocess.run(args,cwd=cwd,env=env,input=input_text,text=True,capture_output=True)
 except FileNotFoundError as e:
  if allow_failure:return None
  raise WorkerError(error_code,redact(e))
 if result.returncode!=0 and not allow_failure:
  detail=(result.stderr or result.stdout or ("exit "+str(result.returncode))).strip()
  raise WorkerError(error_code,redact(detail))
 return result

def root_args(args):
 return args if os.geteuid()==0 else ["sudo","-n",*args]

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
 if not shutil.which("aria2c"): raise WorkerError("ARIA2_NOT_INSTALLED","aria2c is required before remote model staging.")
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
 target=model_path(model_root,req.get("path")); part=target+".part"; control=part+".aria2"
 if os.path.lexists(part) and os.path.isdir(part): raise WorkerError("MODEL_PART_IS_DIRECTORY")
 args=["aria2c","--input-file=-","--allow-overwrite=true","--auto-file-renaming=false","--continue=true","--file-allocation=none","--max-connection-per-server=8","--split=8","--min-split-size=16M","--summary-interval=0","--console-log-level=warn","--dir="+parent,"--out="+os.path.basename(part)]
 result=run_cmd(args,input_text=url+"\\n",error_code="MODEL_DOWNLOAD_NETWORK",allow_failure=True)
 if result is None: raise WorkerError("MODEL_DOWNLOAD_NETWORK")
 if result.returncode!=0:
  detail=(result.stderr or result.stdout or "").strip()
  match=re.search(r"(?:status=|HTTP[/ ]|\\b)(401|403|408|429|5\\d\\d)\\b",detail,re.I)
  code="MODEL_DOWNLOAD_HTTP_"+match.group(1) if match else "MODEL_DOWNLOAD_NETWORK"
  raise WorkerError(code,redact(detail) or "aria2c failed.")
 if not os.path.isfile(part): raise WorkerError("MODEL_DOWNLOAD_NETWORK","aria2c completed without producing the expected file.")
 size=os.path.getsize(part); actual_sha=sha256_file(part)
 if expected_size>=0 and size!=expected_size:
  os.unlink(part)
  if os.path.exists(control): os.unlink(control)
  raise WorkerError("MODEL_SIZE_MISMATCH",f"Expected {expected_size} bytes but downloaded {size} bytes.")
 if expected_sha and actual_sha!=expected_sha:
  os.unlink(part)
  if os.path.exists(control): os.unlink(control)
  raise WorkerError("MODEL_SHA256_MISMATCH","Downloaded model SHA-256 does not match expected value.")
 os.replace(part,target)
 if os.path.exists(control): os.unlink(control)
 emit("progress",stage="model_ready",transferredBytes=size,totalBytes=expected_size)
 return {"exists":True,"valid":True,"size":size,"sha256":actual_sha,"reason":"downloaded","reused":False}

def github_env(token):
 token=str(token or "").strip()
 if not token: raise WorkerError("GITHUB_PAT_REQUIRED","GitHub PAT is required for remote bootstrap.")
 env=os.environ.copy(); env["GH_TOKEN"]=token; env["GH_HOST"]="github.com"
 basic=base64.b64encode(("x-access-token:"+token).encode("utf-8")).decode("ascii")
 env["GIT_CONFIG_COUNT"]="1"; env["GIT_CONFIG_KEY_0"]="http.https://github.com/.extraheader"; env["GIT_CONFIG_VALUE_0"]="AUTHORIZATION: basic "+basic
 return env

def download_file(url,target):
 try:
  request=urllib.request.Request(url,headers={"User-Agent":"ComfyUI-Batch-Studio-Remote-Worker/"+VERSION})
  with urllib.request.urlopen(request,timeout=60) as response, open(target,"wb") as out: shutil.copyfileobj(response,out)
 except Exception as e: raise WorkerError("REMOTE_DEPENDENCY_DOWNLOAD_FAILED",redact(e))

def ensure_tools():
 need_aria=shutil.which("aria2c") is None; need_gh=shutil.which("gh") is None
 if not need_aria and not need_gh:
  return {"aria2":run_cmd(["aria2c","--version"]).stdout.splitlines()[0],"gh":run_cmd(["gh","--version"]).stdout.splitlines()[0],"installed":False}
 if not shutil.which("apt-get"): raise WorkerError("APT_GET_REQUIRED","apt-get is required to install remote bootstrap dependencies.")
 if need_gh:
  run_cmd(root_args(["install","-d","-m","755","/etc/apt/keyrings"]),error_code="GH_REPOSITORY_SETUP_FAILED")
  key_tmp=tempfile.NamedTemporaryFile(delete=False); key_tmp.close()
  source_tmp=tempfile.NamedTemporaryFile(mode="w",delete=False,encoding="utf-8")
  try:
   download_file("https://cli.github.com/packages/githubcli-archive-keyring.gpg",key_tmp.name)
   run_cmd(root_args(["install","-m","0644",key_tmp.name,"/etc/apt/keyrings/githubcli-archive-keyring.gpg"]),error_code="GH_REPOSITORY_SETUP_FAILED")
   arch=run_cmd(["dpkg","--print-architecture"],error_code="GH_REPOSITORY_SETUP_FAILED").stdout.strip()
   source_tmp.write(f"deb [arch={arch} signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main\\n"); source_tmp.close()
   run_cmd(root_args(["install","-d","-m","755","/etc/apt/sources.list.d"]),error_code="GH_REPOSITORY_SETUP_FAILED")
   run_cmd(root_args(["install","-m","0644",source_tmp.name,"/etc/apt/sources.list.d/github-cli.list"]),error_code="GH_REPOSITORY_SETUP_FAILED")
  finally:
   for p in (key_tmp.name,source_tmp.name):
    try: os.unlink(p)
    except OSError: pass
 env=os.environ.copy();env["DEBIAN_FRONTEND"]="noninteractive"
 run_cmd(root_args(["apt-get","update"]),env=env,error_code="APT_UPDATE_FAILED")
 packages=[]
 if need_aria: packages.append("aria2")
 if need_gh: packages.append("gh")
 run_cmd(root_args(["apt-get","install","-y",*packages]),env=env,error_code="APT_INSTALL_FAILED")
 if not shutil.which("aria2c") or not shutil.which("gh"): raise WorkerError("REMOTE_DEPENDENCY_INSTALL_INCOMPLETE")
 return {"aria2":run_cmd(["aria2c","--version"]).stdout.splitlines()[0],"gh":run_cmd(["gh","--version"]).stdout.splitlines()[0],"installed":True}

def github_auth(token):
 env=github_env(token)
 result=run_cmd(["gh","auth","status","--hostname","github.com"],env=env,error_code="GITHUB_AUTH_FAILED")
 return {"ok":True,"ephemeral":True,"status":redact(result.stderr or result.stdout)}

def comfy_python(comfy_root):
 for candidate in (os.path.join(comfy_root,"venv","bin","python"),os.path.join(comfy_root,".venv","bin","python")):
  if os.path.isfile(candidate) and os.access(candidate,os.X_OK): return candidate
 python=shutil.which("python3")
 if not python: raise WorkerError("COMFYUI_PYTHON_MISSING","python3 was not found on the remote host.")
 return python

def hash_files(paths):
 h=hashlib.sha256()
 for p in paths:
  if os.path.isfile(p):
   h.update(os.path.basename(p).encode());h.update(b"\\0")
   with open(p,"rb") as f:
    while True:
     chunk=f.read(CHUNK_SIZE)
     if not chunk: break
     h.update(chunk)
 return h.hexdigest()

def is_system_python(comfy_root,python):
 for candidate in (os.path.join(comfy_root,"venv","bin","python"),os.path.join(comfy_root,".venv","bin","python")):
  if os.path.realpath(python)==os.path.realpath(candidate):return False
 system=shutil.which("python3")
 return bool(system) and os.path.realpath(python)==os.path.realpath(system)

def pip_install_requirements(comfy_root,python,req):
 args=[python,"-m","pip","install","-r",req]
 result=run_cmd(args,cwd=comfy_root,allow_failure=True)
 if result is None:raise WorkerError("PIP_REQUIREMENTS_FAILED","pip executable was not found.")
 if result.returncode==0:return {"retry":"none"}
 detail=((result.stderr or "")+"\\n"+(result.stdout or "")).strip()
 debian_record=("RECORD file not found" in detail and "installed by debian" in detail.lower())
 if not (debian_record and is_system_python(comfy_root,python)):
  raise WorkerError("PIP_REQUIREMENTS_FAILED",redact(detail) or "pip install failed.")
 retry=run_cmd([python,"-m","pip","install","--ignore-installed","-r",req],cwd=comfy_root,allow_failure=True)
 if retry is None:raise WorkerError("PIP_REQUIREMENTS_FAILED","pip retry executable was not found.")
 if retry.returncode!=0:
  retry_detail=((retry.stderr or "")+"\\n"+(retry.stdout or "")).strip()
  raise WorkerError("PIP_REQUIREMENTS_DEBIAN_RETRY_FAILED",redact(retry_detail) or "pip --ignore-installed retry failed.")
 return {"retry":"debian-record-ignore-installed"}

def install_requirements(comfy_root,paths,marker_name):
 paths=[p for p in paths if os.path.isfile(p)]
 if not paths:return False
 marker_dir=os.path.join(comfy_root,".batch-studio","bootstrap");os.makedirs(marker_dir,exist_ok=True)
 marker=os.path.join(marker_dir,marker_name);digest=hash_files(paths)
 if os.path.isfile(marker) and open(marker,encoding="utf-8").read().strip()==digest:return False
 python=comfy_python(comfy_root)
 for req in paths:pip_install_requirements(comfy_root,python,req)
 tmp=marker+".tmp";open(tmp,"w",encoding="utf-8").write(digest+"\\n");os.replace(tmp,marker)
 return True

def patch_manager_startup():
 script="/opt/supervisor-scripts/comfyui.sh"
 if not os.path.isfile(script):return False
 content=open(script,encoding="utf-8").read()
 lines=content.splitlines(True);changed=False
 for i,line in enumerate(lines):
  if "\${COMFYUI_ARGS}" in line and "--enable-manager" not in line:
   lines[i]=line.replace("\${COMFYUI_ARGS}","\${COMFYUI_ARGS} --enable-manager",1);changed=True
 if not changed:return "--enable-manager" in content
 temp=tempfile.NamedTemporaryFile(mode="w",delete=False,encoding="utf-8")
 try:
  temp.write("".join(lines));temp.close()
  run_cmd(root_args(["install","-m","0755",temp.name,script]),error_code="COMFYUI_MANAGER_ENABLE_FAILED")
 finally:
  try:os.unlink(temp.name)
  except OSError:pass
 return True

def update_comfyui(comfy_root,token):
 if not comfy_root or not os.path.isdir(comfy_root):raise WorkerError("REMOTE_COMFYUI_DIRECTORY_MISSING")
 if not os.path.isdir(os.path.join(comfy_root,".git")):raise WorkerError("COMFYUI_GIT_REPOSITORY_REQUIRED","Remote ComfyUI directory is not a Git repository.")
 dirty=run_cmd(["git","status","--porcelain","--untracked-files=no"],cwd=comfy_root,error_code="COMFYUI_GIT_STATUS_FAILED").stdout.strip()
 if dirty:raise WorkerError("COMFYUI_GIT_DIRTY","Remote ComfyUI has tracked local changes; automatic release update was stopped.")
 env=github_env(token)
 latest=run_cmd(["gh","api","repos/comfyanonymous/ComfyUI/releases/latest","--jq",".tag_name"],env=env,error_code="COMFYUI_RELEASE_LOOKUP_FAILED").stdout.strip()
 if not latest:raise WorkerError("COMFYUI_RELEASE_LOOKUP_FAILED","Latest ComfyUI release tag was empty.")
 run_cmd(["git","fetch","--force","https://github.com/comfyanonymous/ComfyUI.git",f"refs/tags/{latest}:refs/tags/{latest}"],cwd=comfy_root,error_code="COMFYUI_GIT_FETCH_FAILED")
 release=run_cmd(["git","rev-parse","--verify",f"refs/tags/{latest}^{{commit}}"],cwd=comfy_root,error_code="COMFYUI_RELEASE_TAG_MISSING").stdout.strip()
 current=run_cmd(["git","rev-parse","HEAD"],cwd=comfy_root,error_code="COMFYUI_GIT_STATUS_FAILED").stdout.strip()
 changed=current!=release
 if changed:run_cmd(["git","checkout","--detach",release],cwd=comfy_root,error_code="COMFYUI_RELEASE_CHECKOUT_FAILED")
 requirements=[os.path.join(comfy_root,"requirements.txt"),os.path.join(comfy_root,"manager_requirements.txt")]
 installed=install_requirements(comfy_root,requirements,"comfy-requirements.sha256")
 manager=patch_manager_startup()
 return {"tag":latest,"commit":release,"changed":changed,"requirementsInstalled":installed,"managerEnabled":manager}

def normalize_origin(value):
 raw=str(value or "").strip().replace("\\\\","/")
 if raw.startswith("git@github.com:"):raw=raw.split(":",1)[1]
 elif raw.startswith("ssh://git@github.com/"):raw=raw.split("github.com/",1)[1]
 elif "github.com/" in raw:raw=raw.split("github.com/",1)[1]
 raw=raw.rstrip("/");raw=raw[:-4] if raw.lower().endswith(".git") else raw
 return raw

def custom_node_commit(dest,ref,env):
 run_cmd(["git","fetch","origin","--prune","--tags"],cwd=dest,env=env,error_code="CUSTOM_NODE_FETCH_FAILED")
 if ref:
  candidates=[f"refs/remotes/origin/{ref}^{{commit}}",f"refs/tags/{ref}^{{commit}}",f"{ref}^{{commit}}"]
  commit=""
  for candidate in candidates:
   result=run_cmd(["git","rev-parse","--verify",candidate],cwd=dest,allow_failure=True)
   if result and result.returncode==0:commit=result.stdout.strip();break
  if not commit:
   fetched=run_cmd(["git","fetch","origin",ref],cwd=dest,env=env,allow_failure=True)
   if fetched and fetched.returncode==0:commit=run_cmd(["git","rev-parse","FETCH_HEAD"],cwd=dest,error_code="CUSTOM_NODE_REF_NOT_FOUND").stdout.strip()
  if not commit:raise WorkerError("CUSTOM_NODE_REF_NOT_FOUND",f"custom_node ref was not found: {ref}")
 else:
  run_cmd(["git","remote","set-head","origin","--auto"],cwd=dest,env=env,allow_failure=True)
  head=run_cmd(["git","symbolic-ref","refs/remotes/origin/HEAD"],cwd=dest,allow_failure=True)
  if head and head.returncode==0:commit=run_cmd(["git","rev-parse",head.stdout.strip()],cwd=dest,error_code="CUSTOM_NODE_FETCH_FAILED").stdout.strip()
  else:commit=run_cmd(["git","rev-parse","HEAD"],cwd=dest,error_code="CUSTOM_NODE_FETCH_FAILED").stdout.strip()
 run_cmd(["git","checkout","--detach",commit],cwd=dest,error_code="CUSTOM_NODE_CHECKOUT_FAILED")
 return commit

def sync_custom_nodes(comfy_root,token,nodes):
 if not isinstance(nodes,list):raise WorkerError("CUSTOM_NODE_CONFIG_INVALID")
 env=github_env(token);custom_root=os.path.join(comfy_root,"custom_nodes");os.makedirs(custom_root,exist_ok=True)
 results=[]
 for item in nodes:
  repository=str((item or {}).get("repository") or "").strip();ref=str((item or {}).get("ref") or "").strip()
  if not REPO_RE.match(repository):raise WorkerError("CUSTOM_NODE_REPOSITORY_INVALID",repository)
  name=repository.split("/",1)[1];dest=os.path.join(custom_root,name);cloned=False
  if os.path.exists(dest):
   if not os.path.isdir(os.path.join(dest,".git")):raise WorkerError("CUSTOM_NODE_DESTINATION_CONFLICT",name)
   dirty=run_cmd(["git","status","--porcelain","--untracked-files=no"],cwd=dest,error_code="CUSTOM_NODE_GIT_STATUS_FAILED").stdout.strip()
   if dirty:raise WorkerError("CUSTOM_NODE_GIT_DIRTY",f"{name} has tracked local changes; automatic repository replacement was stopped.")
   identity=run_cmd(["gh","repo","view","--json","nameWithOwner","--jq",".nameWithOwner"],cwd=dest,env=env,error_code="CUSTOM_NODE_IDENTITY_LOOKUP_FAILED").stdout.strip()
   if identity.lower()!=repository.lower():
    backup_root=os.path.join(comfy_root,".batch-studio","bootstrap","custom-node-backups");os.makedirs(backup_root,exist_ok=True)
    stamp=time.strftime("%Y%m%d-%H%M%S",time.gmtime());safe_identity=re.sub(r"[^A-Za-z0-9_.-]+","__",identity or "unknown")
    backup=os.path.join(backup_root,f"{stamp}-{name}-{safe_identity}");suffix=1
    while os.path.exists(backup):
     backup=os.path.join(backup_root,f"{stamp}-{name}-{safe_identity}-{suffix}");suffix+=1
    shutil.move(dest,backup)
    run_cmd(["gh","repo","clone",repository,dest],env=env,error_code="CUSTOM_NODE_CLONE_FAILED");cloned=True
  else:
   run_cmd(["gh","repo","clone",repository,dest],env=env,error_code="CUSTOM_NODE_CLONE_FAILED");cloned=True
  commit=custom_node_commit(dest,ref,env)
  req=os.path.join(dest,"requirements.txt")
  marker="custom-node-"+repository.replace("/","__")+".sha256"
  installed=install_requirements(comfy_root,[req],marker)
  results.append({"repository":repository,"ref":ref or None,"commit":commit,"cloned":cloned,"requirementsInstalled":installed})
 return {"count":len(results),"nodes":results}

def restart_comfyui():
 if not shutil.which("supervisorctl"):raise WorkerError("SUPERVISORCTL_MISSING","supervisorctl is required to restart ComfyUI after bootstrap.")
 run_cmd(root_args(["supervisorctl","restart","comfyui"]),error_code="COMFYUI_RESTART_FAILED")
 deadline=time.time()+60;last=""
 while time.time()<deadline:
  status=run_cmd(root_args(["supervisorctl","status","comfyui"]),allow_failure=True)
  if status:
   last=(status.stdout or status.stderr or "").strip()
   if status.returncode==0 and "RUNNING" in last:return {"restarted":True,"status":last}
  time.sleep(2)
 raise WorkerError("COMFYUI_RESTART_TIMEOUT",redact(last) or "ComfyUI did not reach RUNNING state.")

def handle(req,root,model_root,comfy_root):
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
 if op=="ensure_tools": return ensure_tools()
 if op=="github_auth": return github_auth(req.get("githubToken"))
 if op=="update_comfyui":
  if not comfy_root:raise WorkerError("COMFYUI_ROOT_NOT_CONFIGURED")
  return update_comfyui(comfy_root,req.get("githubToken"))
 if op=="sync_custom_nodes":
  if not comfy_root:raise WorkerError("COMFYUI_ROOT_NOT_CONFIGURED")
  return sync_custom_nodes(comfy_root,req.get("githubToken"),req.get("nodes") or [])
 if op=="restart_comfyui": return restart_comfyui()
 if op=="model_environment":
  if not model_root: raise WorkerError("MODEL_ROOT_NOT_CONFIGURED")
  if not os.path.isdir(model_root): raise WorkerError("MODEL_ROOT_MISSING","Remote ComfyUI models directory does not exist.")
  return {"ok":True,"modelsRoot":os.path.realpath(model_root),"aria2":bool(shutil.which("aria2c"))}
 if op=="inspect_model":
  if not model_root: raise WorkerError("MODEL_ROOT_NOT_CONFIGURED")
  return inspect_model(model_root,req)
 if op=="stage_model":
  if not model_root: raise WorkerError("MODEL_ROOT_NOT_CONFIGURED")
  return download_model(model_root,req)
 raise WorkerError("UNSUPPORTED_OPERATION")

def main():
 root=os.path.realpath(sys.argv[sys.argv.index("--root")+1]); os.makedirs(root,exist_ok=True)
 model_root=None;comfy_root=None
 if "--model-root" in sys.argv:model_root=os.path.realpath(sys.argv[sys.argv.index("--model-root")+1])
 if "--comfy-root" in sys.argv:comfy_root=os.path.realpath(sys.argv[sys.argv.index("--comfy-root")+1])
 line=sys.stdin.readline(); req=json.loads(line); rid=req.get("requestId")
 try: emit("response",requestId=rid,result=handle(req,root,model_root,comfy_root))
 except Exception as e:
  code=getattr(e,"code",str(e)); emit("response",requestId=rid,error={"code":str(code),"message":redact(str(e))}); sys.exit(2)
if __name__=="__main__": main()
`;

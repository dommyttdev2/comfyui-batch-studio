export const REMOTE_WORKER_VERSION = '10';
export const REMOTE_WORKER_FILE = `#!/usr/bin/env python3
import base64,copy,hashlib,http.client,json,os,random,re,shutil,subprocess,sys,tempfile,time,urllib.error,urllib.parse,urllib.request,zipfile
VERSION="10"
import fcntl
CHUNK_SIZE=8*1024*1024
IMAGE_EXTENSIONS={".png",".jpg",".jpeg",".webp"}
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

def safe_output_dir(comfy_root,prefix,require_exists=True):
 if not comfy_root:raise WorkerError("COMFYUI_ROOT_NOT_CONFIGURED")
 output_root=os.path.realpath(os.path.join(comfy_root,"output"))
 raw=str(prefix or "").replace("\\\\","/").strip("/")
 if not raw or raw==".." or raw.startswith("../") or "/../" in raw:raise WorkerError("REMOTE_OUTPUT_PREFIX_INVALID")
 target=os.path.realpath(os.path.join(output_root,*raw.split("/")))
 if os.path.commonpath([output_root,target])!=output_root:raise WorkerError("REMOTE_OUTPUT_PREFIX_INVALID")
 if require_exists and not os.path.isdir(target):raise WorkerError("REMOTE_ARTIFACT_OUTPUT_MISSING",raw)
 return target

def artifact_package_path(root,run_id):
 safe=re.sub(r"[^A-Za-z0-9_.-]+","_",str(run_id or "run"))
 return contained(root,"artifacts/"+safe+".zip")

def list_artifact_files(output_dir):
 files=[]
 for base,dirs,names in os.walk(output_dir,followlinks=False):
  dirs[:]=[name for name in dirs if not os.path.islink(os.path.join(base,name))]
  for name in names:
   if os.path.splitext(name)[1].lower() not in IMAGE_EXTENSIONS:continue
   target=os.path.join(base,name)
   if os.path.islink(target) or not os.path.isfile(target):continue
   rel=os.path.relpath(target,output_dir).replace(os.sep,"/")
   files.append((rel,target))
 return sorted(files,key=lambda item:item[0])

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
 if existing.get("valid") and not req.get("forceDownload"): return {**existing,"reused":True}
 if os.path.lexists(target) and os.path.isdir(target) and not os.path.islink(target): raise WorkerError("MODEL_DESTINATION_IS_DIRECTORY")
 parent=os.path.dirname(target); os.makedirs(parent,exist_ok=True)
 target=model_path(model_root,req.get("path")); part=target+".part"; control=part+".aria2"
 if req.get("forceDownload"):
  for leftover in (part,control):
   if os.path.lexists(leftover) and os.path.isfile(leftover):os.unlink(leftover)
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

def github_cli_env(token):
 token=str(token or "").strip()
 if not token: raise WorkerError("GITHUB_PAT_REQUIRED","GitHub PAT is required for remote bootstrap.")
 env=os.environ.copy(); env["GH_TOKEN"]=token; env["GH_HOST"]="github.com"
 return env

def github_git_env(token):
 env=github_cli_env(token);token=env["GH_TOKEN"]
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
 env=github_cli_env(token)
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

def validate_comfyui_repository(comfy_root):
 if not comfy_root or not os.path.isdir(comfy_root):raise WorkerError("REMOTE_COMFYUI_DIRECTORY_MISSING")
 if not os.path.isdir(os.path.join(comfy_root,".git")):raise WorkerError("COMFYUI_GIT_REPOSITORY_REQUIRED","Remote ComfyUI directory is not a Git repository.")
 dirty=run_cmd(["git","status","--porcelain","--untracked-files=no"],cwd=comfy_root,error_code="COMFYUI_GIT_STATUS_FAILED").stdout.strip()
 if dirty:raise WorkerError("COMFYUI_GIT_DIRTY","Remote ComfyUI has tracked local changes; automatic release update was stopped.")

def comfyui_release_check(comfy_root,token):
 validate_comfyui_repository(comfy_root)
 cli_env=github_cli_env(token)
 latest=run_cmd(["gh","api","repos/comfyanonymous/ComfyUI/releases/latest","--jq",".tag_name"],env=cli_env,error_code="COMFYUI_RELEASE_LOOKUP_FAILED").stdout.strip()
 if not latest:raise WorkerError("COMFYUI_RELEASE_LOOKUP_FAILED","Latest ComfyUI release tag was empty.")
 if not re.match(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$",latest):raise WorkerError("COMFYUI_RELEASE_TAG_INVALID",latest)
 current=run_cmd(["git","rev-parse","HEAD"],cwd=comfy_root,error_code="COMFYUI_GIT_STATUS_FAILED").stdout.strip()
 return {"tag":latest,"currentCommit":current}

def comfyui_release_fetch(comfy_root,token,tag):
 validate_comfyui_repository(comfy_root)
 tag=str(tag or "").strip()
 if not re.match(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$",tag):raise WorkerError("COMFYUI_RELEASE_TAG_INVALID",tag)
 git_env=github_git_env(token)
 run_cmd(["git","fetch","--force","https://github.com/comfyanonymous/ComfyUI.git",f"refs/tags/{tag}:refs/tags/{tag}"],cwd=comfy_root,env=git_env,error_code="COMFYUI_GIT_FETCH_FAILED")
 release=run_cmd(["git","rev-parse","--verify",f"refs/tags/{tag}^{{commit}}"],cwd=comfy_root,error_code="COMFYUI_RELEASE_TAG_MISSING").stdout.strip()
 return {"tag":tag,"commit":release}

def comfyui_release_checkout(comfy_root,commit):
 validate_comfyui_repository(comfy_root)
 commit=str(commit or "").strip().lower()
 if not re.match(r"^[0-9a-f]{40}$",commit):raise WorkerError("COMFYUI_RELEASE_COMMIT_INVALID",commit)
 verified=run_cmd(["git","rev-parse","--verify",commit+"^{commit}"],cwd=comfy_root,error_code="COMFYUI_RELEASE_TAG_MISSING").stdout.strip()
 current=run_cmd(["git","rev-parse","HEAD"],cwd=comfy_root,error_code="COMFYUI_GIT_STATUS_FAILED").stdout.strip()
 changed=current!=verified
 if changed:run_cmd(["git","checkout","--detach",verified],cwd=comfy_root,error_code="COMFYUI_RELEASE_CHECKOUT_FAILED")
 return {"commit":verified,"previousCommit":current,"changed":changed}

def comfyui_install_requirements(comfy_root):
 validate_comfyui_repository(comfy_root)
 requirements=[os.path.join(comfy_root,"requirements.txt"),os.path.join(comfy_root,"manager_requirements.txt")]
 installed=install_requirements(comfy_root,requirements,"comfy-requirements.sha256")
 return {"requirementsInstalled":installed}

def comfyui_configure_manager(comfy_root):
 validate_comfyui_repository(comfy_root)
 return {"managerEnabled":patch_manager_startup()}

def update_comfyui(comfy_root,token):
 check=comfyui_release_check(comfy_root,token)
 fetched=comfyui_release_fetch(comfy_root,token,check["tag"])
 checkout=comfyui_release_checkout(comfy_root,fetched["commit"])
 requirements=comfyui_install_requirements(comfy_root)
 manager=comfyui_configure_manager(comfy_root)
 return {"tag":check["tag"],"commit":fetched["commit"],"changed":checkout["changed"],"requirementsInstalled":requirements["requirementsInstalled"],"managerEnabled":manager["managerEnabled"]}

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
 cli_env=github_cli_env(token);git_env=github_git_env(token);custom_root=os.path.join(comfy_root,"custom_nodes");os.makedirs(custom_root,exist_ok=True)
 results=[]
 for item in nodes:
  repository=str((item or {}).get("repository") or "").strip();ref=str((item or {}).get("ref") or "").strip()
  if not REPO_RE.match(repository):raise WorkerError("CUSTOM_NODE_REPOSITORY_INVALID",repository)
  name=repository.split("/",1)[1];dest=os.path.join(custom_root,name);cloned=False
  if os.path.exists(dest):
   if not os.path.isdir(os.path.join(dest,".git")):raise WorkerError("CUSTOM_NODE_DESTINATION_CONFLICT",name)
   dirty=run_cmd(["git","status","--porcelain","--untracked-files=no"],cwd=dest,error_code="CUSTOM_NODE_GIT_STATUS_FAILED").stdout.strip()
   if dirty:raise WorkerError("CUSTOM_NODE_GIT_DIRTY",f"{name} has tracked local changes; automatic repository replacement was stopped.")
   identity=run_cmd(["gh","repo","view","--json","nameWithOwner","--jq",".nameWithOwner"],cwd=dest,env=cli_env,error_code="CUSTOM_NODE_IDENTITY_LOOKUP_FAILED").stdout.strip()
   if identity.lower()!=repository.lower():
    backup_root=os.path.join(comfy_root,".batch-studio","bootstrap","custom-node-backups");os.makedirs(backup_root,exist_ok=True)
    stamp=time.strftime("%Y%m%d-%H%M%S",time.gmtime());safe_identity=re.sub(r"[^A-Za-z0-9_.-]+","__",identity or "unknown")
    backup=os.path.join(backup_root,f"{stamp}-{name}-{safe_identity}");suffix=1
    while os.path.exists(backup):
     backup=os.path.join(backup_root,f"{stamp}-{name}-{safe_identity}-{suffix}");suffix+=1
    shutil.move(dest,backup)
    run_cmd(["gh","repo","clone",repository,dest],env=cli_env,error_code="CUSTOM_NODE_CLONE_FAILED");cloned=True
  else:
   run_cmd(["gh","repo","clone",repository,dest],env=cli_env,error_code="CUSTOM_NODE_CLONE_FAILED");cloned=True
  commit=custom_node_commit(dest,ref,git_env)
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

def state_path(root):
 return contained(root,"state.json")

def read_state(root):
 target=state_path(root)
 if not os.path.exists(target):return None
 try:return json.load(open(target,encoding="utf-8"))
 except Exception as e:raise WorkerError("REMOTE_STATE_INVALID",redact(e))

def save_state(root,state):
 target=state_path(root);tmp=target+".tmp"
 with open(tmp,"w",encoding="utf-8") as f:json.dump(state,f,separators=(",",":"))
 os.replace(tmp,target)

def control_path(root):
 return contained(root,"control.json")

def read_control(root):
 target=control_path(root)
 if not os.path.exists(target):return {"stopRequested":False,"interruptRequested":False}
 try:
  value=json.load(open(target,encoding="utf-8"))
  return value if isinstance(value,dict) else {"stopRequested":False,"interruptRequested":False}
 except Exception:return {"stopRequested":False,"interruptRequested":False}

def write_control(root,patch):
 current=read_control(root);current.update(patch)
 target=control_path(root);tmp=target+".tmp"
 with open(tmp,"w",encoding="utf-8") as f:json.dump(current,f,separators=(",",":"))
 os.replace(tmp,target)
 return current

def process_alive(pid):
 try:
  if int(pid or 0)<=0:return False
  os.kill(int(pid),0);return True
 except Exception:return False

def api_request(endpoint,path,method="GET",body=None,timeout=30):
 url=str(endpoint or "http://127.0.0.1:8188").rstrip("/")+path
 data=None;headers={"Accept":"application/json","User-Agent":"ComfyUI-Batch-Studio-Remote-Worker/"+VERSION}
 if body is not None:
  data=json.dumps(body,separators=(",",":")).encode("utf-8");headers["Content-Type"]="application/json"
 request=urllib.request.Request(url,data=data,headers=headers,method=method)
 try:
  with urllib.request.urlopen(request,timeout=timeout) as response:
   raw=response.read().decode("utf-8")
   return response.status,json.loads(raw) if raw else {}
 except urllib.error.HTTPError as e:
  raw=e.read().decode("utf-8","replace")
  try:payload=json.loads(raw) if raw else {}
  except Exception:payload={"error":raw}
  return e.code,payload
 except Exception as e:raise WorkerError("COMFYUI_API_UNAVAILABLE",redact(e))

def require_api(endpoint,path,method="GET",body=None,accepted=(200,)):
 status,payload=api_request(endpoint,path,method,body)
 if status not in accepted:
  message=payload.get("error") if isinstance(payload,dict) else None
  raise WorkerError("REMOTE_COMFYUI_API_FAILED",f"{path}: HTTP {status}: {message or payload}")
 return payload

def resolve_comfy_endpoint(preferred):
 candidates=[]
 for endpoint in (str(preferred or "").rstrip("/"),"http://127.0.0.1:18188","http://127.0.0.1:8188"):
  if endpoint and endpoint not in candidates:candidates.append(endpoint)
 last=None
 for endpoint in candidates:
  try:
   require_api(endpoint,"/system_stats");require_api(endpoint,"/object_info")
   return endpoint
  except WorkerError as e:last=e
 if last:raise last
 raise WorkerError("COMFYUI_API_UNAVAILABLE","Remote ComfyUI API endpoint was not found.")

def prompt_history_state(endpoint,prompt_id):
 payload=require_api(endpoint,"/history/"+urllib.parse.quote(str(prompt_id),safe=""))
 entry=payload.get(str(prompt_id)) if isinstance(payload,dict) else None
 status=(entry or {}).get("status") if isinstance(entry,dict) else {}
 status_str=str((status or {}).get("status_str") or "").lower()
 if status_str=="error":return "error"
 if status_str=="success" or (status or {}).get("completed") is True:return "success"
 return "pending"

def queue_contains(value,prompt_id):
 if value is None:return False
 if isinstance(value,(str,int,float)):return str(value)==str(prompt_id)
 if isinstance(value,list):return any(queue_contains(item,prompt_id) for item in value)
 if isinstance(value,dict):return any(str(key)==str(prompt_id) or queue_contains(item,prompt_id) for key,item in value.items())
 return False

def prompt_queue_state(endpoint,prompt_id):
 queue=require_api(endpoint,"/queue")
 if queue_contains(queue.get("queue_running"),prompt_id):return "running"
 if queue_contains(queue.get("queue_pending"),prompt_id):return "pending"
 return "absent"

def set_run_handle(graph,run_handle):
 for node in graph.values():
  if isinstance(node,dict) and node.get("class_type") in ("ScenePrompter","SceneMatrix","ScenePresetReference","ScenePrompterExpand"):
   inputs=node.setdefault("inputs",{});inputs["run_handle"]=run_handle;inputs.pop("user_id",None)

def set_expand(graph,expand_node_id,continuous_id,index):
 node=graph.get(str(expand_node_id))
 if not isinstance(node,dict) or node.get("class_type")!="ScenePrompterExpand":raise WorkerError("REMOTE_EXPAND_NODE_MISSING")
 inputs=node.setdefault("inputs",{});inputs["current_index"]=int(index);inputs["run_id"]=continuous_id;inputs["seed_base"]=random.randint(0,0x7fffffff);inputs["seed_base_literal"]=False

def set_output_prefix(graph,output_prefix,branch_id):
 prefix=str(output_prefix or "").replace("\\\\","/").strip("/")
 branch=re.sub(r"[^A-Za-z0-9_.-]+","_",str(branch_id or "branch")).strip("._") or "branch"
 if not prefix:raise WorkerError("REMOTE_OUTPUT_PREFIX_INVALID")
 for node in graph.values():
  if isinstance(node,dict) and node.get("class_type")=="SceneSaveImage":
   node.setdefault("inputs",{})["path"]=prefix+"/"+branch

def sequence_progress(state,stage,**extra):
 emit("progress",stage=stage,runId=state.get("runId"),status=state.get("status"),current=state.get("current"),overallCompleted=state.get("overallCompleted",0),**extra)

def mark_prompt_success(root,state,branch,index):
 completed=state.setdefault("completed",{});before=int(completed.get(branch["branchId"],0))
 if before<=index:
  completed[branch["branchId"]]=index+1
  state["overallCompleted"]=int(state.get("overallCompleted",0))+1
 state["current"]={"branchId":branch["branchId"],"leafId":None,"index":index+1,"promptId":None}
 save_state(root,state);sequence_progress(state,"prompt_terminal",terminal="success")

def wait_prompt_terminal(root,state,branch,index,endpoint,prompt_id):
 missing_polls=0;api_errors=0;failure_code=None
 while True:
  try:
   terminal=prompt_history_state(endpoint,prompt_id)
   if terminal!="pending":break
   if prompt_queue_state(endpoint,prompt_id)=="absent":
    missing_polls+=1
    if missing_polls>=4:
     # Queue->History promotion can be delayed. Read history once more before declaring loss.
     terminal=prompt_history_state(endpoint,prompt_id)
     if terminal!="pending":break
     if prompt_queue_state(endpoint,prompt_id)=="absent":
      failure_code="REMOTE_PROMPT_LOST";break
     missing_polls=0
   else:missing_polls=0
   api_errors=0
  except WorkerError:
   api_errors+=1
   if api_errors>=3:
    failure_code="REMOTE_PROMPT_STATUS_UNAVAILABLE";break
  control=read_control(root)
  if control.get("interruptRequested"):
   state["status"]="interrupting";save_state(root,state)
  time.sleep(0.25)
 if not failure_code and terminal=="success":
  mark_prompt_success(root,state,branch,index);return "success"
 control=read_control(root)
 state["status"]="interrupted" if control.get("interruptRequested") else "failed"
 if state["status"]=="interrupted":state["error"]=None
 elif failure_code:
  message="Prompt "+str(prompt_id)+" is absent from both ComfyUI Queue and History; verify the Run before retrying." if failure_code=="REMOTE_PROMPT_LOST" else "ComfyUI Queue/History API was unavailable during prompt monitoring."
  state["error"]={"code":failure_code,"message":message}
 else:state["error"]={"code":"REMOTE_PROMPT_FAILED","message":"ComfyUI prompt failed: "+str(prompt_id)}
 # Preserve an uncertain prompt id. Automatically re-submitting it could generate a duplicate.
 if not failure_code:
  state["current"]={"branchId":branch["branchId"],"leafId":branch["leafIds"][index] if index<len(branch["leafIds"]) else None,"index":index,"promptId":None}
 state["workerPid"]=0;save_state(root,state);sequence_progress(state,"prompt_terminal",terminal="error");return "error"

def reconcile_current_prompt(root,state,branches,endpoint):
 current=state.get("current") or {};prompt_id=current.get("promptId")
 if not prompt_id:return True
 branch=next((item for item in branches if item.get("branchId")==current.get("branchId")),None)
 if not branch:raise WorkerError("REMOTE_RECONCILE_BRANCH_MISSING")
 index=int(current.get("index") or 0)
 terminal=prompt_history_state(endpoint,prompt_id)
 if terminal=="pending":
  queued=prompt_queue_state(endpoint,prompt_id)
  if queued=="absent":raise WorkerError("REMOTE_RECONCILE_PROMPT_LOST","Current prompt is absent from both history and queue.")
  sequence_progress(state,"reconciled",promptId=prompt_id,queueState=queued)
  return wait_prompt_terminal(root,state,branch,index,endpoint,prompt_id)=="success"
 if terminal=="success":
  sequence_progress(state,"reconciled",promptId=prompt_id,historyState="success")
  mark_prompt_success(root,state,branch,index);return True
 control=read_control(root)
 state["status"]="interrupted" if control.get("interruptRequested") else "failed"
 state["current"]={"branchId":current.get("branchId"),"leafId":current.get("leafId"),"index":index,"promptId":None}
 if state["status"]=="failed":state["error"]={"code":"REMOTE_PROMPT_FAILED","message":"Recovered prompt is terminal error: "+str(prompt_id)}
 save_state(root,state);sequence_progress(state,"reconciled",promptId=prompt_id,historyState="error");return False

def scene_prepare(endpoint,graph,expand_node_id,workflow,client_id):
 payload=require_api(endpoint,"/scene_prompt/runs/prepare","POST",{"api_graph":{"output":graph},"expand_node_id":str(expand_node_id),"workflow":workflow,"client_id":client_id})
 handle=str(payload.get("run_handle") or "")
 if not handle:raise WorkerError("REMOTE_SCENE_PREPARE_FAILED","Scene Prompt prepare returned no run_handle.")
 set_run_handle(graph,handle);return payload

def scene_claim(endpoint,run_handle,prompt_id):
 payload=require_api(endpoint,"/scene_prompt/runs/claim","POST",{"run_handle":run_handle,"prompt_id":prompt_id})
 if not payload.get("claimed"):raise WorkerError("REMOTE_SCENE_CLAIM_FAILED")
 return True

def scene_finalize(endpoint,run_handle,expand_node_id,prompt_id):
 for _ in range(120):
  status,payload=api_request(endpoint,"/scene_prompt/runs/finalize","POST",{"run_handle":run_handle,"expand_node_id":str(expand_node_id),"prompt_id":prompt_id})
  state=str(payload.get("state") or "") if isinstance(payload,dict) else ""
  if status==200 and state=="finalized":return True
  if status==202 or state in ("pending","in_progress"):time.sleep(0.25);continue
  raise WorkerError("REMOTE_SCENE_FINALIZE_FAILED",f"state={state or 'unknown'} status={status}")
 raise WorkerError("REMOTE_SCENE_FINALIZE_TIMEOUT")

def scene_release(endpoint,run_handle):
 status,payload=api_request(endpoint,"/scene_prompt/runs/release","POST",{"run_handle":run_handle})
 return status==200 and bool((payload or {}).get("released"))

def initialize_sequence(root,req):
 previous=read_state(root)
 run_id=str(req.get("runId") or "")
 if not run_id:raise WorkerError("REMOTE_RUN_ID_REQUIRED")
 if isinstance(previous,dict) and previous.get("runId")==run_id and previous.get("status") in ("running","interrupting","paused","interrupted","completed","failed"):
  return previous
 branches=req.get("branches") or []
 total=sum(len(item.get("leafIds") or []) for item in branches)
 state={"version":1,"runId":run_id,"status":"running","workerPid":os.getpid(),"current":{"branchId":None,"leafId":None,"index":0,"promptId":None},"completed":{},"overallCompleted":0,"overallTotal":total,"promptIds":[],"branchRuns":{},"artifact":{"outputPrefix":str(req.get("outputPrefix") or ""),"capturedAt":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())},"error":None}
 save_state(root,state);write_control(root,{"stopRequested":False,"interruptRequested":False});return state

def run_scene_sequence(root,req):
 endpoint=resolve_comfy_endpoint(req.get("comfyEndpoint"))
 branches=req.get("branches") or [];workflow=req.get("workflow");run_id=str(req.get("runId") or "")
 state=initialize_sequence(root,req)
 if state.get("status")=="completed":return {"state":state}
 owner_pid=int(state.get("workerPid") or 0)
 if owner_pid and owner_pid!=os.getpid() and process_alive(owner_pid):return {"state":state,"alreadyRunning":True}
 if state.get("status") in ("paused","interrupted","failed"):
  if not req.get("resume"):return {"state":state}
  error=(state.get("error") or {})
  if state.get("status")=="failed" and error.get("code") not in (None,"REMOTE_PROMPT_FAILED"):
   raise WorkerError("REMOTE_RESUME_UNSAFE","The failed worker state requires a separate recovery action: "+str(error.get("code")))
  current=state.get("current") or {}
  prompt_id=str(current.get("promptId") or "")
  if prompt_id and prompt_history_state(endpoint,prompt_id)=="error":
   current["promptId"]=None
  elif prompt_id and prompt_queue_state(endpoint,prompt_id)=="absent" and prompt_history_state(endpoint,prompt_id)!="success":
   raise WorkerError("REMOTE_RESUME_PROMPT_UNCERTAIN","The last submitted prompt is absent from both history and queue. A duplicate submission was prevented.")
  write_control(root,{"stopRequested":False,"interruptRequested":False})
  state["status"]="running";state["error"]=None;save_state(root,state)
 state["workerPid"]=os.getpid();state["status"]="running";save_state(root,state)
 if not reconcile_current_prompt(root,state,branches,endpoint):return {"state":read_state(root)}
 for branch in branches:
  branch_id=str(branch.get("branchId") or "");leaf_ids=branch.get("leafIds") or [];expand_id=str(branch.get("expandNodeId") or "")
  completed=int((state.get("completed") or {}).get(branch_id,0))
  if completed>=len(leaf_ids):continue
  if read_control(root).get("stopRequested"):
   state["status"]="paused";state["workerPid"]=0;save_state(root,state);sequence_progress(state,"scheduling_stopped");return {"state":state}
  graph=copy.deepcopy(branch.get("graph") or {});continuous_id=run_id+":"+branch_id
  set_output_prefix(graph,(state.get("artifact") or {}).get("outputPrefix"),branch_id)
  branch_runs=state.setdefault("branchRuns",{});meta=branch_runs.get(branch_id) or {}
  run_handle=str(meta.get("runHandle") or "")
  if not run_handle:
   set_expand(graph,expand_id,continuous_id,completed)
   prepared=scene_prepare(endpoint,graph,expand_id,workflow,run_id);run_handle=str(prepared["run_handle"])
   expected=len(leaf_ids)
   if int(prepared.get("total_batches",expected))!=expected:raise WorkerError("REMOTE_SCENE_PLAN_MISMATCH")
   meta={"runHandle":run_handle,"claimed":False,"lastPromptId":""};branch_runs[branch_id]=meta;save_state(root,state)
  else:set_run_handle(graph,run_handle)
  try:
   for index in range(completed,len(leaf_ids)):
    if read_control(root).get("stopRequested"):
     state["status"]="paused";state["workerPid"]=0;save_state(root,state);sequence_progress(state,"scheduling_stopped");return {"state":state}
    set_expand(graph,expand_id,continuous_id,index)
    state["current"]={"branchId":branch_id,"leafId":leaf_ids[index],"index":index,"promptId":None};save_state(root,state);sequence_progress(state,"prompt_submitting")
    submitted=require_api(endpoint,"/prompt","POST",{"prompt":graph,"client_id":run_id});prompt_id=str(submitted.get("prompt_id") or "")
    if not prompt_id:raise WorkerError("REMOTE_PROMPT_SUBMIT_FAILED")
    state["current"]["promptId"]=prompt_id
    if prompt_id not in state["promptIds"]:state["promptIds"].append(prompt_id)
    meta["lastPromptId"]=prompt_id;save_state(root,state);sequence_progress(state,"prompt_submitted",promptId=prompt_id)
    if not meta.get("claimed"):
     scene_claim(endpoint,run_handle,prompt_id);meta["claimed"]=True;save_state(root,state)
    if wait_prompt_terminal(root,state,branch,index,endpoint,prompt_id)!="success":return {"state":read_state(root)}
   last_prompt=str(meta.get("lastPromptId") or "")
   if last_prompt:scene_finalize(endpoint,run_handle,expand_id,last_prompt)
   sequence_progress(state,"branch_completed",branchId=branch_id)
  finally:
   try:scene_release(endpoint,run_handle)
   except Exception:pass
   branch_runs.pop(branch_id,None);save_state(root,state)
 state["status"]="completed";state["workerPid"]=0;state["current"]={"branchId":None,"leafId":None,"index":0,"promptId":None};save_state(root,state);sequence_progress(state,"sequence_completed")
 return {"state":state}

def stop_scene_sequence(root):
 state=read_state(root)
 if not isinstance(state,dict):return {"ok":False,"state":None}
 write_control(root,{"stopRequested":True})
 return {"ok":True,"state":state}

def force_interrupt_sequence(root,endpoint):
 state=read_state(root)
 if not isinstance(state,dict):return {"interrupted":False,"state":None}
 prompt_id=str(((state.get("current") or {}).get("promptId")) or "")
 if not prompt_id:return {"interrupted":False,"state":state}
 endpoint=resolve_comfy_endpoint(endpoint)
 queue=require_api(endpoint,"/queue")
 if not queue_contains(queue.get("queue_running"),prompt_id):return {"interrupted":False,"state":state}
 write_control(root,{"interruptRequested":True})
 require_api(endpoint,"/interrupt","POST",{},accepted=(200,))
 state["status"]="interrupting";save_state(root,state)
 sequence_progress(state,"interrupt_requested",promptId=prompt_id)
 return {"interrupted":True,"state":state}

def archive_artifact_path(rel):
 parts=[part for part in str(rel or "").replace("\\\\","/").split("/") if part and part not in (".","..")]
 if not parts:raise WorkerError("REMOTE_ARTIFACT_PATH_INVALID")
 if len(parts)==1:return parts[0]
 return parts[0]+"/"+parts[-1]

def package_artifacts(root,comfy_root,req):
 state=read_state(root)
 if not isinstance(state,dict) or state.get("status")!="completed":raise WorkerError("REMOTE_ARTIFACT_GENERATION_INCOMPLETE")
 run_id=str(state.get("runId") or req.get("runId") or "")
 prefix=str((state.get("artifact") or {}).get("outputPrefix") or req.get("outputPrefix") or "")
 archive_name=str(req.get("archiveFileName") or "").strip()
 if not re.match(r"^[0-9]{8}_[0-9]{6}[.]zip$",archive_name):raise WorkerError("REMOTE_ARTIFACT_ARCHIVE_NAME_INVALID",archive_name or "missing")
 output_dir=safe_output_dir(comfy_root,prefix)
 files=list_artifact_files(output_dir);expected=int(req.get("expectedCount",-1))
 if expected<0:raise WorkerError("REMOTE_ARTIFACT_EXPECTED_COUNT_REQUIRED")
 if len(files)!=expected:raise WorkerError("REMOTE_ARTIFACT_COUNT_MISMATCH",f"Expected {expected} artifacts but found {len(files)}.")
 packaged=[];seen=set()
 for rel,target in files:
  archive_path=archive_artifact_path(rel)
  if archive_path in seen:raise WorkerError("REMOTE_ARTIFACT_ARCHIVE_PATH_COLLISION",archive_path)
  seen.add(archive_path);packaged.append((archive_path,target))
 artifact_dir=contained(root,"artifacts");os.makedirs(artifact_dir,exist_ok=True)
 package=artifact_package_path(root,run_id);tmp=package+".part"
 try:
  if os.path.exists(tmp):os.unlink(tmp)
  with zipfile.ZipFile(tmp,"w",compression=zipfile.ZIP_STORED,allowZip64=True) as archive:
   for archive_path,target in packaged:archive.write(target,archive_path)
  os.replace(tmp,package)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
 package_size=os.path.getsize(package);package_sha=sha256_file(package)
 entries=[{"path":archive_path,"size":os.path.getsize(target),"sha256":sha256_file(target)} for archive_path,target in packaged]
 manifest={"version":2,"runId":run_id,"outputPrefix":prefix,"artifactCount":len(entries),"package":{"fileName":archive_name,"size":package_size,"sha256":package_sha},"artifacts":entries}
 manifest_json=json.dumps(manifest,sort_keys=True,separators=(",",":"))+chr(10)
 manifest_bytes=manifest_json.encode("utf-8");manifest_sha=hashlib.sha256(manifest_bytes).hexdigest()
 manifest_path=contained(root,"artifacts/manifest.json");tmp_manifest=manifest_path+".tmp"
 with open(tmp_manifest,"wb") as f:f.write(manifest_bytes)
 os.replace(tmp_manifest,manifest_path)
 state.setdefault("artifact",{}).update({"manifestSha256":manifest_sha,"artifactCount":len(entries),"package":{"fileName":os.path.basename(package),"size":package_size,"sha256":package_sha}})
 save_state(root,state);sequence_progress(state,"artifacts_packaged",artifactCount=len(entries),packageSize=package_size)
 return {"artifactCount":len(entries),"manifestSha256":manifest_sha,"manifestJson":manifest_json,"package":{"fileName":os.path.basename(package),"size":package_size,"sha256":package_sha}}

def http_put_file(url,target,offset,length,headers):
 parsed=urllib.parse.urlparse(str(url or ""))
 if parsed.scheme not in ("http","https") or not parsed.hostname:raise WorkerError("R2_UPLOAD_URL_INVALID")
 conn_cls=http.client.HTTPSConnection if parsed.scheme=="https" else http.client.HTTPConnection
 conn=conn_cls(parsed.hostname,parsed.port,timeout=120)
 request_path=parsed.path or "/"
 if parsed.query:request_path+="?"+parsed.query
 try:
  conn.putrequest("PUT",request_path)
  conn.putheader("Content-Length",str(length))
  for name,value in (headers or {}).items():
   lower=str(name).lower()
   if lower in ("host","content-length","transfer-encoding"):continue
   conn.putheader(str(name),str(value))
  conn.endheaders()
  remaining=length
  with open(target,"rb") as f:
   f.seek(offset)
   while remaining>0:
    chunk=f.read(min(CHUNK_SIZE,remaining))
    if not chunk:raise WorkerError("R2_UPLOAD_SHORT_READ")
    conn.send(chunk);remaining-=len(chunk)
  response=conn.getresponse();body=response.read(4096).decode("utf-8","replace");status=response.status;etag=response.getheader("ETag") or ""
  if status<200 or status>=300:raise WorkerError("R2_UPLOAD_HTTP_"+str(status),redact(body) or ("HTTP "+str(status)))
  return {"status":status,"etag":etag}
 except WorkerError:raise
 except Exception as e:raise WorkerError("R2_UPLOAD_NETWORK",redact(e))
 finally:
  try:conn.close()
  except Exception:pass

def upload_artifact_package(root,req):
 state=read_state(root)
 if not isinstance(state,dict):raise WorkerError("REMOTE_STATE_INVALID")
 package_meta=((state.get("artifact") or {}).get("package") or {})
 package=artifact_package_path(root,state.get("runId"))
 if not os.path.isfile(package):raise WorkerError("REMOTE_ARTIFACT_PACKAGE_MISSING")
 size=os.path.getsize(package);expected_size=int(package_meta.get("size") or -1)
 if expected_size>=0 and size!=expected_size:raise WorkerError("REMOTE_ARTIFACT_PACKAGE_SIZE_MISMATCH")
 offset=int(req.get("offset") or 0);length=int(req.get("length") if req.get("length") is not None else size)
 if offset<0 or length<0 or offset+length>size:raise WorkerError("REMOTE_ARTIFACT_UPLOAD_RANGE_INVALID")
 result=http_put_file(req.get("url"),package,offset,length,req.get("headers") or {})
 emit("progress",stage="artifact_uploaded",offset=offset,length=length,status=result["status"])
 return {**result,"offset":offset,"length":length,"size":size,"sha256":str(package_meta.get("sha256") or "")}

def cleanup_artifacts(root,comfy_root):
 state=read_state(root)
 if not isinstance(state,dict):return {"ok":True,"outputsRemoved":False,"packageRemoved":False}
 prefix=str((state.get("artifact") or {}).get("outputPrefix") or "")
 artifact_dir=contained(root,"artifacts");package_removed=False;outputs_removed=False
 if os.path.exists(artifact_dir):
  shutil.rmtree(artifact_dir);package_removed=True
 if prefix:
  output_dir=safe_output_dir(comfy_root,prefix,require_exists=False)
  if os.path.exists(output_dir):
   shutil.rmtree(output_dir);outputs_removed=True
 emit("progress",stage="artifact_cleanup",outputsRemoved=outputs_removed,packageRemoved=package_removed)
 return {"ok":True,"outputsRemoved":outputs_removed,"packageRemoved":package_removed}

def handle(req,root,model_root,comfy_root):
 op=req.get("op")
 if op=="health": return {"ok":True,"version":VERSION,"pid":os.getpid()}
 if op=="status":
  return {"ok":True,"state":read_state(root)}
 if op=="run_scene_sequence":
  lock=os.open(contained(root,"scene-sequence.lock"),os.O_RDWR|os.O_CREAT,0o600)
  try:
   try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
   except BlockingIOError:return {"state":read_state(root),"alreadyRunning":True}
   return run_scene_sequence(root,req)
  finally:
   os.close(lock)
 if op=="stop_scene_sequence": return stop_scene_sequence(root)
 if op=="force_interrupt_sequence": return force_interrupt_sequence(root,str(req.get("comfyEndpoint") or "http://127.0.0.1:8188"))
 if op=="package_artifacts": return package_artifacts(root,comfy_root,req)
 if op=="upload_artifact_package": return upload_artifact_package(root,req)
 if op=="cleanup_artifacts": return cleanup_artifacts(root,comfy_root)
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
 if op=="comfyui_release_check":
  if not comfy_root:raise WorkerError("COMFYUI_ROOT_NOT_CONFIGURED")
  return comfyui_release_check(comfy_root,req.get("githubToken"))
 if op=="comfyui_release_fetch":
  if not comfy_root:raise WorkerError("COMFYUI_ROOT_NOT_CONFIGURED")
  return comfyui_release_fetch(comfy_root,req.get("githubToken"),req.get("tag"))
 if op=="comfyui_release_checkout":
  if not comfy_root:raise WorkerError("COMFYUI_ROOT_NOT_CONFIGURED")
  return comfyui_release_checkout(comfy_root,req.get("commit"))
 if op=="comfyui_install_requirements":
  if not comfy_root:raise WorkerError("COMFYUI_ROOT_NOT_CONFIGURED")
  return comfyui_install_requirements(comfy_root)
 if op=="comfyui_configure_manager":
  if not comfy_root:raise WorkerError("COMFYUI_ROOT_NOT_CONFIGURED")
  return comfyui_configure_manager(comfy_root)
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

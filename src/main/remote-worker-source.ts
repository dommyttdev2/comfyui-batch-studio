export const REMOTE_WORKER_VERSION='1';
export const REMOTE_WORKER_FILE=`#!/usr/bin/env python3
import hashlib,json,os,sys
VERSION="1"

def emit(kind, **data):
 print(json.dumps({"type":kind,**data},separators=(",",":")),flush=True)

def contained(root,value):
 root=os.path.realpath(root); candidate=os.path.abspath(os.path.join(root,value))
 parent=os.path.realpath(os.path.dirname(candidate))
 if os.path.commonpath([root,parent]) != root: raise ValueError("PATH_OUTSIDE_ALLOWED_ROOT")
 if os.path.lexists(candidate) and os.path.realpath(candidate) != candidate: raise ValueError("SYMLINK_ESCAPE_REJECTED")
 real=os.path.realpath(candidate)
 if os.path.commonpath([root,real]) != root: raise ValueError("PATH_OUTSIDE_ALLOWED_ROOT")
 return real

def handle(req,root):
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
 raise ValueError("UNSUPPORTED_OPERATION")

def main():
 root=os.path.realpath(sys.argv[sys.argv.index("--root")+1]); os.makedirs(root,exist_ok=True)
 line=sys.stdin.readline(); req=json.loads(line); rid=req.get("requestId")
 try: emit("response",requestId=rid,result=handle(req,root))
 except Exception as e: emit("response",requestId=rid,error={"code":str(e),"message":str(e)}); sys.exit(2)
if __name__=="__main__": main()
`;

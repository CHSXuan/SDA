"""Unprivileged process-tree sampler. Missing OS counters remain null."""
import os,sys,time,json,subprocess,ctypes
root=int(sys.argv[1]);previous={}

# ── Per-core CPU sampling ──────────────────────────────────────────────
_per_core_prev=[];_libsys=None
def _get_libsys():
    global _libsys
    if _libsys is None:
        import ctypes.util
        _libsys=ctypes.CDLL(ctypes.util.find_library('System'))
        _libsys.mach_host_self.restype=ctypes.c_uint32
        _libsys.host_processor_info.argtypes=[ctypes.c_uint32,ctypes.c_int,ctypes.POINTER(ctypes.c_int),ctypes.POINTER(ctypes.POINTER(ctypes.c_int)),ctypes.POINTER(ctypes.c_uint32)]
        _libsys.host_processor_info.restype=ctypes.c_int
        _libsys.mach_task_self=ctypes.c_uint32.in_dll(_libsys,'mach_task_self')
        _libsys.vm_deallocate.argtypes=[ctypes.c_uint32,ctypes.c_void_p,ctypes.c_uint]
    return _libsys

def _sample_per_core():
    """Return list of per-core CPU percentages (0-100). Empty on failure."""
    global _per_core_prev
    try:
        if sys.platform=='darwin':
            lib=_get_libsys()
            host=lib.mach_host_self();n=ctypes.c_int(0);info=ctypes.POINTER(ctypes.c_int)();count=ctypes.c_uint32(0)
            # PROCESSOR_CPU_LOAD_INFO=2 (per-core), CPU_STATE_MAX=4
            if lib.host_processor_info(host,2,ctypes.byref(n),ctypes.byref(info),ctypes.byref(count))!=0:return []
            nc=n.value;states=4;raw=[]
            for i in range(nc):raw.append([info[i*states+s] for s in range(states)])
            lib.vm_deallocate(lib.mach_task_self,ctypes.addressof(info.contents),ctypes.sizeof(ctypes.c_int)*nc*states)
            totals=[sum(core) for core in raw];prev=_per_core_prev;_per_core_prev=[(raw[i],totals[i]) for i in range(nc)]
            if len(prev)!=nc:return []
            result=[]
            for i in range(nc):
                dt=totals[i]-prev[i][1]
                if dt<=0:result.append(0.0);continue
                idle_delta=raw[i][2]-prev[i][0][2];result.append(max(0.0,min(100.0,(dt-idle_delta)*100.0/dt)))
            return result
        elif os.path.exists('/proc/stat'):
            cores=[]
            for line in open('/proc/stat'):
                if not line.startswith('cpu') or line.startswith('cpu '):continue
                parts=line.split();vals=list(map(int,parts[1:]));cores.append(vals)
            nc=len(cores);prev=_per_core_prev;_per_core_prev=[(c,sum(c)) for c in cores]
            if len(prev)!=nc:return []
            result=[]
            for i in range(nc):
                dt=sum(cores[i])-prev[i][1]
                if dt<=0:result.append(0.0);continue
                idle_delta=cores[i][3]-prev[i][0][3];result.append(max(0.0,min(100.0,(dt-idle_delta)*100.0/dt)))
            return result
    except:pass
    return []

class Usage(ctypes.Structure):
    _fields_=[('uuid',ctypes.c_byte*16)]+[(name,ctypes.c_uint64) for name in ['user','system','pkg_idle','interrupt','pageins','wired','resident','footprint','start','exit','child_user','child_system','child_pkg','child_interrupt','child_pageins','child_elapsed','disk_read','disk_write']]
libproc=ctypes.CDLL('/usr/lib/libproc.dylib') if sys.platform=='darwin' else None
while True:
    try:
        os.kill(root,0)
        now=time.time();raw=subprocess.check_output(['ps','-axo','pid=,ppid=,%cpu=,rss=,comm='],text=True)
        processes=[line.strip().split(None,4) for line in raw.splitlines() if line.strip()]
        ids={root}
        for _ in range(16):
            expanded=ids|{int(p[0]) for p in processes if int(p[1]) in ids}
            if expanded==ids:break
            ids=expanded
        rows=[];next_previous={}
        for p in processes:
            pid=int(p[0])
            if pid not in ids:continue
            row=dict(pid=pid,name=p[4],cpuPercent=float(p[2]),workingSetBytes=int(p[3])*1024,readBytesPerSecond=None,writeBytesPerSecond=None)
            if sys.platform.startswith('linux'):
                try:
                    stat=open(f'/proc/{pid}/stat').read().rsplit(')',1)[1].split();cpu=(int(stat[11])+int(stat[12]))/os.sysconf('SC_CLK_TCK');key=(pid,stat[19])
                    io=dict(line.split(':') for line in open(f'/proc/{pid}/io'))
                    current=(now,cpu,int(io['read_bytes']),int(io['write_bytes']))
                    old=previous.get(key)
                    if old:
                        dt=now-old[0];row.update(cpuPercent=(cpu-old[1])*100/dt,readBytesPerSecond=max(0,(current[2]-old[2])/dt),writeBytesPerSecond=max(0,(current[3]-old[3])/dt))
                    next_previous[key]=current
                except (OSError,ValueError):pass
            elif libproc:
                usage=Usage()
                if libproc.proc_pid_rusage(pid,2,ctypes.byref(usage))==0:
                    current=(now,(usage.user+usage.system)/1e9,usage.disk_read,usage.disk_write);key=(pid,usage.start);old=previous.get(key)
                    row['workingSetBytes']=usage.resident
                    if old:
                        dt=now-old[0];row.update(cpuPercent=(current[1]-old[1])*100/dt,readBytesPerSecond=max(0,(current[2]-old[2])/dt),writeBytesPerSecond=max(0,(current[3]-old[3])/dt))
                    next_previous[key]=current
                else:row['ioUnavailable']='proc_pid_rusage denied'
            else:row['ioUnavailable']='unsupported OS' 
            rows.append(row)
        previous=next_previous
        totalCpu=sum(r['cpuPercent'] for r in rows)
        # ps %cpu and proc_pid_rusage both report against a single core (100% = one core).
        # Supply totalMachinePercent (= totalCpu / coreCount) so the dashboard can show
        # whole-machine utilisation, and keep cpuPercent for backward compatibility.
        coreCount=os.cpu_count() or 1
        perCore=_sample_per_core()
        print(json.dumps(dict(time=round(now*1000),processes=rows,cpuPercent=totalCpu,totalMachinePercent=totalCpu/coreCount,perCoreCpu=perCore or None,coreCount=len(perCore) or coreCount,workingSetBytes=sum(r['workingSetBytes'] for r in rows),readBytesPerSecond=sum(r['readBytesPerSecond'] or 0 for r in rows) if any(r['readBytesPerSecond'] is not None for r in rows) else None,writeBytesPerSecond=sum(r['writeBytesPerSecond'] or 0 for r in rows) if any(r['writeBytesPerSecond'] is not None for r in rows) else None)),flush=True)
        time.sleep(1)
    except ProcessLookupError:break
    except Exception as e:
        print(json.dumps({'unavailable':str(e)}),flush=True);time.sleep(2)

"""Unprivileged process-tree sampler. Missing OS counters remain null."""
import os,sys,time,json,subprocess,ctypes
root=int(sys.argv[1]);previous={}
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
        print(json.dumps(dict(time=round(now*1000),processes=rows,cpuPercent=sum(r['cpuPercent'] for r in rows),workingSetBytes=sum(r['workingSetBytes'] for r in rows),readBytesPerSecond=sum(r['readBytesPerSecond'] or 0 for r in rows) if any(r['readBytesPerSecond'] is not None for r in rows) else None,writeBytesPerSecond=sum(r['writeBytesPerSecond'] or 0 for r in rows) if any(r['writeBytesPerSecond'] is not None for r in rows) else None)),flush=True)
        time.sleep(1)
    except ProcessLookupError:break
    except Exception as e:
        print(json.dumps({'unavailable':str(e)}),flush=True);time.sleep(2)

import {useEffect,useRef,useState} from "react";
import {Copy,Headphones,Radio,Pause,Play,SkipBack,SkipForward,RotateCcw,Unplug,ShieldCheck,Smartphone,Wifi,Settings2} from "lucide-react";
import Select from "./Select";
import {Slider} from "./Slider";
import {WindowTitlebar} from "./WindowTitlebar";
import type {RemoteStatus,RemoteCommand} from "../remote-session";
import type {OutputDevices} from "./OutputPanel";
import "./RemotePanel.css";

export default function RemotePanel({status}:{status:RemoteStatus}) {
  const [tab,setTab]=useState("connection");
  const scrollRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(scrollRef.current)scrollRef.current.scrollTop=0;},[tab]);
  const [invite,setInvite]=useState("");const [port,setPort]=useState("49632");
  const [pairingKey,setPairingKey]=useState("");const [keyLoaded,setKeyLoaded]=useState(false);
  const [bufferMs,setBufferMs]=useState("300");const [exclusive,setExclusive]=useState(true);
  const [deviceId,setDeviceId]=useState("");const [devices,setDevices]=useState<OutputDevices["devices"]>([]);
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [copied,setCopied]=useState("");
  const api=window.sdaDesktop;
  useEffect(()=>{let alive=true;Promise.resolve(api?.getRemotePairingKey?.()).then(key=>{if(alive){setPairingKey(key??"");setKeyLoaded(true);}},()=>{if(alive){setError("无法读取已保存的密钥，请重新打开设置");}});return()=>{alive=false;};},[]);
  useEffect(()=>{if(status.role==="client")setTab("connection");},[status.role]);
  useEffect(()=>{if(status.role==="off")void api?.getOutputDevices?.().then(v=>setDevices(v.devices)).catch(()=>{});},[status.role]);
  const run=async(action:"host"|"join"|"stop"|"maxPeers"|"hlsAllowed"|"localMute"|"deviceApprove"|"deviceReject"|"deviceRevoke"|"devicePermission"|"deviceDisconnect",value?:unknown)=>{
    setBusy(true);setError("");
    try{await api?.remoteSession?.(action,value);}catch(e){setError(String(e));}finally{setBusy(false);}
  };
  return <section className="remote-panel" aria-label="多设备无损远程">
    <div className="remote-summary" role="status"><div className="remote-status-heading"><span className={`remote-status-dot ${status.role!=="off"?"is-active":""}`}/><strong>{status.role==="off"?"尚未开启":status.role==="host"?"正在发送":"正在收听"}</strong>{status.role==="off"&&<button className="remote-start" data-button="primary" disabled={busy||!keyLoaded} onClick={()=>void run("host",{port:Number(port),bufferMs:Number(bufferMs),pairingKey})}><Radio size={16}/><span>开启发送</span></button>}{status.role!=="off"&&<button className="remote-stop" disabled={busy} onClick={()=>void run("stop")}><Unplug size={14}/><span>{status.role==="host"?"停止发送":"断开连接"}</span></button>}</div><small>{status.detail}</small><div className="remote-metrics"><span><Smartphone size={14}/>{status.connectedDevices?.length??0} 台在线</span><span><Headphones size={14}/>主机渲染 · 无损传输</span>{status.role!=="off"&&<span>缓冲 {status.bufferMs} ms</span>}</div></div>

    <div className="remote-tabs" role="tablist" aria-label="无线远程分类">
      {[{id:"connection",label:"连接"},{id:"devices",label:`设备${status.pendingDevices?.length ? ` · ${status.pendingDevices.length}` : ""}`},{id:"preferences",label:"播放设置"}].filter(item=>status.role!=="client"||item.id==="connection").map(item=><button key={item.id} id={`remote-tab-${item.id}`} type="button" role="tab" aria-selected={tab===item.id} aria-controls={`remote-page-${item.id}`} tabIndex={tab===item.id?0:-1} onClick={()=>setTab(item.id)} onKeyDown={event=>{
        const buttons=Array.from(event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[role="tab"]'));const i=buttons.indexOf(event.currentTarget);const next=event.key==="ArrowRight"?(i+1)%buttons.length:event.key==="ArrowLeft"?(i-1+buttons.length)%buttons.length:event.key==="Home"?0:event.key==="End"?buttons.length-1:-1;
        if(next>=0){event.preventDefault();buttons[next]?.focus();buttons[next]?.click();}
      }}>{item.label}</button>)}
    </div>
    <div className="remote-tab-scroll" ref={scrollRef}>
    {status.role!=="client"&&<section className="remote-device-list remote-tab-content" role="tabpanel" id="remote-page-devices" aria-labelledby="remote-tab-devices" hidden={tab!=="devices"} aria-label="设备授权">
      <h4><span><ShieldCheck size={17}/>设备管理</span><small>{status.connectedDevices?.length??0} / {status.capacity??2} 在线</small></h4>
      <label className="remote-capacity">最大同时连接数<Select aria-label="最大同时连接数" value={String(status.capacity??2)} disabled={busy} onChange={e=>void run("maxPeers",Number(e.target.value))}>{Array.from({length:16},(_,i)=><option key={i+1} value={i+1}>{i+1} 台</option>)}</Select><small>设置自动保存。调低上限不打断现有收听，新的连接需等待空位。</small></label>
      {(status.pendingDevices??[]).map(device=><div className="remote-device" key={device.id}><strong>{device.name}</strong><small>{device.address} · 请求连接</small><div><button disabled={busy} onClick={()=>void run("deviceApprove",{id:device.id,canControl:true})}>允许收听与控制</button><button disabled={busy} onClick={()=>void run("deviceApprove",{id:device.id,canControl:false})}>仅收听</button><button disabled={busy} onClick={()=>void run("deviceReject",{id:device.id})}>拒绝</button></div></div>)}
      {(status.devices??[]).map(device=>{const online=status.connectedDevices?.some(p=>p.id===device.id);return <div className="remote-device" key={device.id}><div className="remote-device-name"><Smartphone size={18}/><strong>{device.name}</strong><span className={online?"remote-online":"remote-offline"}>{online?"在线":"离线"}</span></div><div><Select aria-label={`${device.name} 权限`} value={device.canControl?"control":"listen"} disabled={busy} onChange={e=>void run("devicePermission",{id:device.id,canControl:e.target.value==="control"})}><option value="control">收听与控制</option><option value="listen">仅收听</option></Select>{online&&<button disabled={busy} onClick={()=>void run("deviceDisconnect",{id:device.id})}>断开</button>}<button disabled={busy} onClick={()=>void run("deviceRevoke",{id:device.id})}>撤销授权</button></div></div>;})}
      {!status.devices?.length&&!status.pendingDevices?.length&&<div className="remote-empty"><Smartphone size={26}/><strong>还没有配对设备</strong><small>在手机或平板打开连接链接，首次授权后即可记住设备。</small></div>}
    </section>}

    <div className="remote-tab-content" role="tabpanel" id="remote-page-connection" aria-labelledby="remote-tab-connection" hidden={tab!=="connection"}>
    {status.role==="off"?<>
      <fieldset className="settings-group" disabled={busy||!keyLoaded}><legend>连接设置</legend>
        <label>监听端口<input aria-label="远程监听端口" inputMode="numeric" value={port} onChange={e=>setPort(e.target.value)}/></label>
        <label>网络缓冲<Select value={bufferMs} onChange={e=>setBufferMs(e.target.value)} aria-label="远程网络缓冲"><option value="100">100 ms · 稳定局域网</option><option value="300">300 ms · 默认</option><option value="600">600 ms · 异地组网</option><option value="1000">1000 ms · 高延迟网络</option></Select></label>
        <label>自定义密钥<input type="password" aria-label="自定义配对密钥" autoComplete="new-password" spellCheck={false} maxLength={256} placeholder="留空使用自动生成并保存的密钥" value={pairingKey} onChange={e=>setPairingKey(e.target.value)}/></label>
        <small>开启发送后自动记住，下次无需重填。清空后开启发送可恢复自动密钥。</small>
      </fieldset>
      <details className="remote-legacy"><summary>连接旧版 SDA 主机</summary><fieldset className="settings-group" disabled={busy}><legend>原生客户端收听</legend>
        <label>主机配对地址<input aria-label="主机配对地址" autoComplete="off" spellCheck={false} placeholder="粘贴 sda://… 完整地址" value={invite} onChange={e=>setInvite(e.target.value)}/></label>
        <label>收听设备<Select value={deviceId} onChange={e=>setDeviceId(e.target.value)} aria-label="远程收听设备"><option value="">系统默认设备</option>{devices.filter(d=>d.available).map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</Select></label>
        <label>输出方式<Select value={exclusive?"exclusive":"shared"} onChange={e=>setExclusive(e.target.value==="exclusive")} aria-label="远程输出方式"><option value="exclusive">WASAPI 独占 · 推荐</option><option value="shared">WASAPI 共享 · 设备须设为 48 kHz</option></Select></label>
        <button data-button="primary" disabled={!invite.trim()} onClick={()=>void run("join",{invite:invite.trim(),deviceId:deviceId||null,exclusive})}><Headphones size={16}/><span>连接并收听</span></button>
      </fieldset></details>
      <p className="remote-note">接收端可用新版 Chrome、Edge、Firefox 或 Safari，无需安装 SDA。异地使用组网地址，防火墙允许所选 TCP 端口。网页和原生客户端共享你设置的同时连接上限。</p>
    </>:<>
      {status.role==="host"&&<div className="remote-invites"><h4><Wifi size={17}/>连接你的设备</h4><p className="remote-section-hint">复制链接，在手机、平板或电脑的浏览器打开。</p>{(status.webInvites??[]).map((link,i)=><div className="remote-invite" key={link}><code>https://{status.addresses[i]}:{status.port}</code><button aria-label={`复制 ${status.addresses[i]} 网页链接`} onClick={()=>void navigator.clipboard.writeText(link).then(()=>setCopied(link)).catch(()=>setError("无法复制到剪贴板"))}><Copy size={15}/><span>{copied===link?"已复制":"复制链接"}</span></button></div>)}{!status.webInvites?.length&&<p>没有可用的局域网地址，请先连接网络。</p>}<details className="remote-help"><summary>连接说明</summary><small>首次访问会提示主机自签名 HTTPS 证书，确认地址属于主机后继续。网页内点击「连接并收听」。PCM 原样传输，浏览器和系统可能重采样。</small>{status.invites.length>0&&<details><summary>原生客户端</summary>{status.invites.map((link,i)=><div className="remote-invite" key={link}><code>{status.addresses[i]}:{status.port}</code><button aria-label={`复制 ${status.addresses[i]} 原生配对地址`} onClick={()=>void navigator.clipboard.writeText(link).then(()=>setCopied(link)).catch(()=>setError("无法复制到剪贴板"))}>{copied===link?"已复制":"复制原生配对地址"}</button></div>)}</details>}<small>链接含首次配对密钥。自动生成的密钥会保存，重新开启仍可使用原链接；复用自定义密钥时旧链接仍可重新连接。关闭电脑端静音可同时播放；远端存在网络缓冲延迟。</small></details></div>}

    </>}
    </div>
    {status.role!=="client"&&<div className="remote-preferences remote-tab-content" role="tabpanel" id="remote-page-preferences" aria-labelledby="remote-tab-preferences" hidden={tab!=="preferences"}><h4><Settings2 size={17}/>播放选项</h4>
    {<label className="remote-local-mute"><input type="checkbox" role="switch" checked={status.hlsAllowed===true} disabled={busy} onChange={e=>void run("hlsAllowed",e.target.checked)}/><span>允许 HLS 原生播放</span><small>默认关闭，使用低延迟 PCM。开启后 Safari 可使用原生无损 HLS；请刷新网页并重新连接。关闭会断开现有 HLS 收听。</small></label>}
    {<label className="remote-local-mute"><input type="checkbox" role="switch" checked={status.localMuted!==false} disabled={busy} onChange={e=>void run("localMute",e.target.checked)}/><span>电脑端静音</span><small>手机发起播放时静音电脑；电脑发起播放时恢复本机声音。仅连接或浏览手机界面不会静音。</small></label>}
    </div>}
    </div>
    {busy&&<p className="remote-progress" role="status">正在应用，请稍候…</p>}{error&&<p className="remote-error" role="alert">{error}</p>}
  </section>;
}
const time=(seconds:number)=>`${Math.floor(Math.max(0,seconds)/60)}:${String(Math.floor(Math.max(0,seconds)%60)).padStart(2,"0")}`;
export function RemoteClientView({status}:{status:RemoteStatus}) {
  const [error,setError]=useState("");const [pending,setPending]=useState<Set<string>>(new Set());
  const state=status.state;const connected=status.phase==="connected";
  useEffect(()=>window.sdaDesktop?.onRemoteResult?.(result=>{
    setPending(current=>{const next=new Set(current);next.delete(result.id);return next;});if(result.error)setError(result.error);
  }),[]);
  const send=async(command:RemoteCommand)=>{
    setError("");try{const id=await window.sdaDesktop?.remoteCommand?.(command);if(id)setPending(p=>new Set(p).add(id));}catch(e){setError(String(e));}
  };
  return <div className="app remote-client"><WindowTitlebar/><div className="remote-client-content">
    <header className="remote-client-heading"><div><span className="remote-eyebrow">SDA REMOTE</span><h1>无损远程监听</h1></div><span className="remote-badge">无损 · PCM</span></header>
    <div className="remote-now"><Headphones size={42}/><h2>{state?.title||"等待主机选择歌曲"}</h2><p>{status.detail}</p><small>{status.format}</small>
      <progress value={state?.position??0} max={Math.max(state?.duration??0,state?.position??0,1)} aria-label="主机播放进度"/><div className="remote-time"><span>{time(state?.position??0)}</span><span>{time(state?.duration??0)}</span></div>
      <div className="remote-transport"><button disabled={!connected} onClick={()=>void send({action:"previous"})} title="上一首" aria-label="上一首"><SkipBack/></button><button data-button="primary" disabled={!connected} onClick={()=>void send({action:state?.playing&&!state.paused?"pause":"play"})} title={state?.playing&&!state.paused?"暂停":"播放"} aria-label={state?.playing&&!state.paused?"暂停":"播放"}>{state?.playing&&!state.paused?<Pause/>:<Play/>}</button><button disabled={!connected} onClick={()=>void send({action:"next"})} title="下一首" aria-label="下一首"><SkipForward/></button><button disabled={!connected} onClick={()=>void send({action:"replay"})} title="从头播放" aria-label="从头播放"><RotateCcw size={19}/></button></div>
      <label>主机音量 <Slider aria-label="远程主机音量" min="0" max="1" step="0.01" value={state?.volume??1} disabled={!connected} onChange={e=>void send({action:"volume",value:Number(e.target.value)})}/><span>{Math.round((state?.volume??1)*100)}%</span></label>
      <div className="remote-options"><label>循环<Select aria-label="远程循环模式" value={state?.playbackMode??"sequence"} disabled={!connected} onChange={e=>void send({action:"playbackMode",value:e.target.value})}><option value="sequence">顺序播放</option><option value="repeat-all">列表循环</option><option value="repeat-one">单曲循环</option></Select></label><label>立体声渲染<Select aria-label="远程立体声渲染" value={state?.stereoMode??"original"} disabled={!connected} onChange={e=>void send({action:"stereoMode",value:e.target.value})}><option value="original">原始立体声</option><option value="dry">双耳渲染</option><option value="room">录音棚房间</option></Select></label></div>
    </div>
    <section className="remote-queue"><h3>主机播放列表 <small>{state?.playlist.length??0} 首</small></h3>{state?.playlist.map((item,i)=><button key={item.id} className={state.currentId===item.id?"active":""} disabled={!connected} onClick={()=>void send({action:"track",value:item.id})}><span>{String(i+1).padStart(2,"0")}</span><strong>{item.title}</strong>{state.currentId===item.id&&<Radio size={16}/>}</button>)}</section>
    <footer className="remote-client-footer"><div><strong>{status.output?.actualName??"正在打开收听设备"}</strong><small>{status.output?.mode==="exclusive"?"WASAPI 独占":"WASAPI 共享"} · {status.output?.sampleFormat??"48 kHz"} · 缓冲 {Math.round(status.queuedMs)} ms · 已接收 {(status.bytes/1048576).toFixed(1)} MB</small></div><button onClick={()=>void window.sdaDesktop?.remoteSession?.("stop").catch(e=>setError(String(e)))}><Unplug size={16}/><span>断开连接</span></button></footer>
    {error&&<p role="alert" className="remote-error">{error}</p>}{pending.size>0&&<small role="status">等待主机应用操作…</small>}
  </div></div>;
}

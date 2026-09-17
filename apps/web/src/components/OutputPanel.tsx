import { useEffect, useState } from "react";
import Select from "./Select";
import "./OutputPanel.css";

export interface OutputSettings { deviceId: string | null; exclusive: boolean; remoteCompatible?:boolean }
export interface OutputDevices {
  status: { requested: OutputSettings; actualId?: string | null; actualName?: string | null;
    mode?: string | null; sampleRate?: number | null; channels?: number | null;
    bufferMs?: number | null; state: string; detail: string };
  devices: {id:string;name:string;available:boolean;isDefault:boolean;sampleRate?:number|null;channels?:number|null}[];
}
const isMac = typeof navigator !== "undefined"
  && (/Mac|iPhone|iPad/.test(navigator.userAgent) || document.documentElement?.dataset?.platform === "darwin");

export default function OutputPanel() {
  const [data,setData] = useState<OutputDevices | null>(null);
  const [draft,setDraft] = useState<OutputSettings>({deviceId:null,exclusive:false});
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [takeoverStatus,setTakeoverStatus] = useState("");
  const bridge=window.sdaDesktop;
  const asio = draft.deviceId?.startsWith("asio:") ?? false;
  const directSound = draft.deviceId?.startsWith("dsound:") ?? false;
  useEffect(() => {
    let alive=true;
    const off=bridge?.onOutputDevices?.(value=>{if(alive)setData(value);});
    bridge?.getOutputDevices?.().then(value=>{if(alive){setData(value);setDraft(value.status.requested);}})
      .catch(e=>{if(alive)setError(String(e));});
    return ()=>{alive=false;off?.();};
  },[bridge]);
  if(!bridge?.getOutputDevices)return null;
  const apply=async()=>{
    setBusy(true);setError("");
    try {
      const result=await bridge.setOutputDevice!(draft);
      if(result.status)setData(result);
      if(!result.accepted)setError(result.status?.detail || "切换失败，原输出恢复失败时请重试");
    }catch(e){setError(String(e));}finally{setBusy(false);}
  };
  const openPanel=async()=>{
    setBusy(true);setError("");
    try { if(!await bridge.openAsioControlPanel?.()) setError("控制面板打开失败，请检查驱动状态"); }
    catch(e){setError(String(e));}finally{setBusy(false);}
  };
  const refresh=async()=>{
    setBusy(true);setError("");
    try{setData(await bridge.getOutputDevices!());}catch(e){setError(String(e));}finally{setBusy(false);}
  };
  const takeover=async()=>{
    setBusy(true);setError("");setTakeoverStatus("正在接管 AirPods…");
    try { setTakeoverStatus(await bridge.takeoverAirpodsAudio!()); }
    catch(e){setTakeoverStatus("");setError(String(e));}finally{setBusy(false);}
  };
  return <fieldset className="settings-group output-manager" disabled={busy}>
    <legend>音频输出设备</legend>
    <label>输出到
      <Select aria-label="输出设备" disabled={draft.remoteCompatible} value={draft.deviceId??""} onChange={e=>setDraft({...draft,deviceId:e.target.value||null,exclusive:e.target.value.startsWith("asio:")?false:draft.exclusive})}>
        {!asio&&!directSound&&<option value="">跟随系统默认</option>}
        {draft.deviceId&&!data?.devices.some(d=>d.id===draft.deviceId)&&<option value={draft.deviceId}>已保存的设备（未连接）</option>}
        {data?.devices.filter(d=>asio?d.id.startsWith("asio:"):directSound?d.id.startsWith("dsound:"):!d.id.startsWith("asio:")&&!d.id.startsWith("dsound:")).map(d=><option key={d.id} value={d.id} disabled={!d.available}>{d.name}{d.isDefault?" · 默认":""}{!d.available?" · 不可用":""}</option>)}
      </Select>
    </label>
    <label>访问方式
      <Select aria-label="输出访问方式" value={directSound?"directsound":asio?"asio":draft.remoteCompatible?"remote":draft.exclusive?"exclusive":"shared"} onChange={e=>setDraft({...draft,deviceId:e.target.value==="directsound"?(data?.devices.find(d=>d.id.startsWith("dsound:")&&d.available)?.id??null):e.target.value==="asio"?(data?.devices.find(d=>d.id.startsWith("asio:")&&d.available)?.id??null):e.target.value==="remote"||asio||directSound?null:draft.deviceId,remoteCompatible:e.target.value==="remote",exclusive:e.target.value==="exclusive"})}>
        <option value="remote">远程兼容 · UU / RDP</option><option value="shared">{isMac ? "CoreAudio 共享" : "WASAPI 共享"}</option><option value="exclusive">{isMac ? "CoreAudio 独占 · 本机监听" : "WASAPI 独占 · 本机监听"}</option>
        {!isMac&&<option value="directsound" disabled={!data?.devices.some(d=>d.id.startsWith("dsound:")&&d.available)}>DirectSound · 共享输出</option>}
        {!isMac&&<option value="asio" disabled={!data?.devices.some(d=>d.id.startsWith("asio:")&&d.available)}>ASIO{!data?.devices.some(d=>d.id.startsWith("asio:"))?" · 未安装驱动":""}</option>}
      </Select>
    </label>
    {draft.remoteCompatible&&<small>跟随系统默认，使用共享混音供远程采集；远程软件切换默认设备时自动跟随。</small>}
    {draft.exclusive&&<small role="note">独占绕过系统混音，UU 等远程软件可能听不到。远程听音请选择「远程兼容」。</small>}
    {directSound&&<small>使用 Windows 共享音频链路，保留双耳渲染与头部追踪。UU 通常可以采集系统播放声音；延迟不一定低于 WASAPI。</small>}
    {asio&&<small>使用驱动的输出 1 / 2 和首选缓冲。缓冲大小、硬件端口请在厂商驱动或 ASIO4ALL 控制面板设置。ASIO 不经过 Windows 共享混音，UU / RDP 可能无法采集；降低缓冲不代表能加快解码或空间渲染。</small>}
    <div className="output-manager-actions"><button data-button="primary" onClick={()=>void apply()} disabled={!data}>{busy?"处理中…":data?.status.state==="unavailable"?"应用并重试":"应用"}</button><button onClick={()=>void refresh()}>刷新设备</button>{asio&&<button onClick={()=>void openPanel()} disabled={data?.status.state!=="ready"||data?.status.mode!=="asio"||data?.status.actualId!==draft.deviceId} title="先应用所选 ASIO 设备，再打开正在使用的驱动面板">打开 ASIO 控制面板</button>}</div>
    {!isMac&&bridge.takeoverAirpodsAudio&&<div className="output-manager-actions"><button onClick={()=>void takeover()}>接管 AirPods 音频</button><small>从手机切回后连接不稳时使用，无需开启头追。需要已安装 SDA 蓝牙驱动。</small></div>}
    {takeoverStatus&&<p role="status">{takeoverStatus}</p>}
    <div className="output-manager-status" aria-live="polite">
      <strong>{data?.status.state==="ready"?data.status.actualName:"输出不可用"}</strong>
      {data?.status.state==="ready"&&<span>{data.status.mode==="directsound"?"DirectSound":data.status.mode==="asio"?"ASIO":data.status.mode==="exclusive"?"实际独占":"实际共享"} · {(data.status.sampleRate??0)/1000} kHz · {data.status.channels} 声道 · 缓冲 {data.status.bufferMs?.toFixed(1)} ms</span>}
      {isMac&&data?.status.state==="ready"&&<small>macOS CoreAudio 输出；独占模式由系统管理。</small>}
      <small>内部渲染 48 kHz / 双耳双声道，按设备采样率转换。输出会话失效时自动重新初始化，不重连蓝牙；指定耳机断开后不会切到外放。</small>
      {(error||data?.status.detail)&&<p role="status">{error||data?.status.detail}</p>}
    </div>
  </fieldset>;
}

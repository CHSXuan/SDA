import {useEffect,useState} from "react";
import {createPortal} from "react-dom";
import {MediaPicker} from "./MediaPicker";
type Entry={id:string;name:string;directions:number;method:string;createdAt?:string;createdAtSource?:string};
export function PersonalHrtfLibrary({currentHead,disabled,revision,onApply}:{currentHead:string;disabled:boolean;revision?:string;onApply:(id:string)=>Promise<void>}){
 const [entries,setEntries]=useState<Entry[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState("");
 const [picker,setPicker]=useState<{id?:string}|null>(null),[editing,setEditing]=useState<{id:string;copy:boolean;name:string}|null>(null);
 const [applying,setApplying]=useState<string|null>(null);
 const api=window.sdaDesktop;
 const refresh=async()=>{const values=await api?.listPersonalHrtf?.();if(values)setEntries(values);};
 useEffect(()=>{let alive=true;void api?.listPersonalHrtf?.().then(v=>{if(alive)setEntries(v)}).catch(e=>{if(alive)setError(String(e))});return()=>{alive=false};},[revision,currentHead,disabled]);
 const run=async(work:()=>Promise<void>)=>{if(busy||disabled)return;setBusy(true);setError("");setMessage("");try{await work();await refresh()}catch(e){setError(String(e))}finally{setBusy(false)}};
 const imported=(paths:string[])=>void run(async()=>{if(paths.length!==1)throw Error("一次请选择一个个人档案");const result=await api?.importPersonalHrtf?.(paths[0]!);if(!result)throw Error("个人档案导入接口不可用");setMessage(`已导入“${result.name}”，点击切换即可使用。`)});
 const exported=(id:string,paths:string[])=>void run(async()=>{const result=await api?.personalHrtfArchive?.("export",id,paths[0]!);if(!result?.path)throw Error("导出接口不可用");setMessage(`已导出：${result.path}`)});
 const saveName=()=>{const value=editing;if(!value)return;void run(async()=>{if(value.copy){if(!api?.personalHrtfArchive)throw Error("另存接口不可用");await api.personalHrtfArchive("copy",value.id,value.name)}else{if(!api?.renamePersonalHrtf)throw Error("命名接口不可用");await api.renamePersonalHrtf(value.id,value.name)}setEditing(null);setMessage(value.copy?"已另存为独立档案。":"名称已保存。")})};
 const blocked=busy||disabled;
 return <section className="phrtf-library" aria-label="个人档案管理">
  <div className="phrtf-library-head"><h4>个人档案</h4><button disabled={blocked||!api?.importPersonalHrtf} onClick={()=>setPicker({})}>导入档案</button></div>
  <small>播放中可直接切换，无需暂停。支持导入 .phrtf / SOFA 档案。</small>
  {!entries.length&&<p className="phrtf-library-empty">尚无个人档案，完成测试后会显示在这里。</p>}
  {entries.map(p=>{const legacyParametric=p.method==="parametric-feedback";return <article className={`phrtf-library-item${p.id===currentHead?" active":""}`} key={p.id}>
   <div><strong>{p.name}</strong>{p.id===currentHead&&<span className="phrtf-badge">使用中</span>}</div>
   <small>{p.directions} 个方向 · {p.method==="bundled-measured-proxy"?"内置实测代理":p.method==="parametric-feedback"?"旧版合成档案":"SOFA 测量"}</small>
   {legacyParametric&&<small className="phrtf-error">旧版随机合成档案不再用于播放，请选择内置实测 HRTF 或重新完成验证。</small>}
   <small className="phrtf-created">{p.createdAt&&Number.isFinite(Date.parse(p.createdAt))?<>{p.createdAtSource==='file'?'创建日期（文件记录）':'创建日期'} · <time dateTime={p.createdAt}>{new Date(p.createdAt).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</time></>:"创建日期未知"}</small>
   <div className="phrtf-actions">
    <button disabled={blocked||legacyParametric||p.id===currentHead} onClick={()=>void run(async()=>{setApplying(p.id);try{await onApply(p.id);setMessage(`已应用“${p.name}”，当前播放使用此档案。`)}finally{setApplying(null)}})}>{applying===p.id?"切换中…":legacyParametric?"需重新验证":p.id===currentHead?"已启用":"切换"}</button>
   </div>
   <details className="phrtf-file-actions"><summary>管理档案</summary><div className="phrtf-actions">
    <button disabled={blocked||!api?.renamePersonalHrtf} onClick={()=>setEditing({id:p.id,name:p.name,copy:false})}>命名</button>
    <button disabled={blocked||!api?.personalHrtfArchive} onClick={()=>setEditing({id:p.id,name:`${p.name} 副本`,copy:true})}>另存为</button>
    <button disabled={blocked||!api?.personalHrtfArchive} onClick={()=>setPicker({id:p.id})}>导出</button>
   </div></details>
  </article>})}
  {editing&&<form className="phrtf-library-name" onSubmit={e=>{e.preventDefault();saveName()}}><label>{editing.copy?"新档案名称":"档案名称"}<input autoFocus maxLength={80} aria-label="档案名称" disabled={blocked} value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})}/></label><div className="phrtf-actions"><button data-button="primary" disabled={blocked||!editing.name.trim()} type="submit">保存名称</button><button type="button" disabled={blocked} onClick={()=>setEditing(null)}>取消</button></div></form>}
  {message&&<p role="status" className="phrtf-library-message">{message}</p>}{error&&<p role="alert" className="phrtf-error">{error}</p>}
  {picker&&createPortal(<MediaPicker kind="hrtf" mode={picker.id?"folder":"files"} onClose={()=>setPicker(null)} onSelect={paths=>picker.id?exported(picker.id,paths):imported(paths)}/>,document.body)}
 </section>;
}

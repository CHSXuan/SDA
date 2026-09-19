const $=id=>document.getElementById(id);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const num=(v,n=2)=>finite(v)?v.toFixed(n):'未测得';
const ms=v=>finite(v)?`${num(v)} ms`:'未测得';
const size=v=>!finite(v)?'未测得':v>=1048576?`${num(v/1048576)} MB`:`${num(v/1024)} KB`;
const definitions={
 'decode.loudness':['音量平衡响度分析','decode','frame'],
 'decode.resample':['转换音频采样率','decode','frame'],
 'decode.output_audio':['解码产出的音频','decode','audio'],
 'decode.next_frame':['取出解码帧','decode','audio'],
 'decode.packet_push':['执行音频解码','decode','packet'],
 'decode.queue_wait':['等待解码任务开始','decode','call'],
 'decode.message_including_wait':['解码任务（含内部等待）','decode','call'],
 'decode.to_binaural_callback_estimate':['解码 → 双耳输出（估算）','output','call'],
 'hrtf.object.convolution':['对象独立双耳卷积','hrtf','frame'],
 'hrtf.object.filter_update':['更新对象方向滤波器','hrtf','tap'],
 'hrtf.object.legacy':['对象布局双耳卷积','hrtf','frame'],
 'hrtf.bed_bus':['声床声道双耳卷积','hrtf','frame'],
 'hrtf.reflection_bus':['房间反射双耳卷积','hrtf','frame'],
 'hrtf.bank_prepare':['准备双耳滤波器组','hrtf','channel'],
 'object.routing_and_mix':['独立对象定位与混音','routing','frame'],
 'source.routing_and_mix':['每路声音定位与混音','routing','frame'],
 'pcm.source_ingest':['声音送入原生队列','routing','frame'],
 'pcm.ipc_to_native_ack':['发送声音 → 原生确认','routing','frame'],
 'pcm.scheduled_lead_ms':['已排队音频的提前量','routing','frame'],
 'pcm.to_output_callback_estimate':['声音入队 → 输出（估算）','output','call'],
 'render.block':['一整块声音的渲染','output','frame'],
 'output.callback':['输出回调统计开销','output','frame'],
 'output.callback_work':['输出回调执行','output','frame'],
 'output.underrun_frames':['输出时缺少的音频','output','gap'],
 'room.generate_including_wait':['生成房间（含等待）','room','call'],
 'room.worker_runtime':['房间计算进程运行','room','channel'],
 'room.apply_including_queue':['应用房间（含排队）','room','call'],
 'native.command':['原生控制指令','routing','call'],
 'native.health.fifoFramesAvailable':['输出缓冲中剩余音频','output','gauge'],
 'native.health.callbackMaxMicros':['输出回调的历史峰值','output','gauge'],
 'native.health.renderWaitLockMicros':['渲染线程等待锁','output','gauge'],
 'native.health.controlLockMaxMicros':['控制线程等待锁峰值','output','gauge'],
 '3d.cpu_submit':['3D 画面 CPU 提交','3d','draw'],
 '3d.gpu_elapsed':['3D 画面 GPU 绘制','3d','call'],
 '3d.gpu_batch_elapsed':['3D GPU 批次耗时（非单帧）','3d','call'],
 '3d.frame_interval':['两次画面更新的间隔','3d','call'],
 '3d.triangles':['3D 绘制三角形数量','3d','triangle'],
 '3d.gpu_timer_unavailable':['显卡不支持绘制计时','3d','unavailable'],
 '3d.gpu_disjoint':['显卡计时本次无效','3d','unavailable'],
 'network.native_tx_bytes':['原生网络发送','network','byte'],
 'network.native_rx_bytes':['原生网络接收','network','byte'],
 'network.rtc_tx_bytes':['WebRTC 发送','network','byte'],
 'network.rtc_rx_bytes':['WebRTC 接收','network','byte'],
 'network.chromium_unavailable':['浏览器网络计数不可用','network','unavailable'],
 'renderer.unresponsive':['主界面没有响应','3d','call'],
 'renderer.responsive':['主界面恢复响应','3d','call']
};
const commands={health:'检查运行状态',setPerformance:'性能记录',setHrtf:'切换双耳滤波器',setCinema:'应用房间',setLayout:'切换声道布局',setPose:'更新头部位置',pcm:'接收音频',pcmBatch:'批量接收音频',reset:'重置播放',setPaused:'暂停或继续',setOutputActive:'切换输出',setProgramGain:'调整音量平衡',setObjectHrtf:'切换对象渲染',setDirectionalHrtf:'切换实际方向渲染'};
const channels={L:'左前',R:'右前',C:'中置',LFE:'低音',Lss:'左侧',Rss:'右侧',Lrs:'左后',Rrs:'右后',Ltf:'左前上',Rtf:'右前上',Ltr:'左后上',Rtr:'右后上',all:'整体',scene:'空间画面',stereo:'双耳输出',output:'输出设备',remote:'远程传输',codec:'解码器',drain:'解码器',decoder:'解码器',push:'接收数据',open:'打开文件',init:'初始化',flush:'处理剩余数据',adm:'ADM 音频',mpegh:'360RA / MPEG-H',truehd:'Dolby TrueHD',eac3:'Dolby Digital Plus',ac3:'Dolby Digital',pcm:'PCM 音频',alac:'ALAC 音频',flac:'FLAC 音频',dts:'DTS 音频',iamf:'IAMF 音频'};
function source(r){if(r.id?.startsWith('obj:'))return '对象 '+r.id.slice(4).replace(':near-reference','（近场参考）');if(r.id?.startsWith('bed:'))return '声床 '+r.id.slice(4);if(r.stage==='native.command')return commands[r.id]||'播放控制';return channels[r.id]||r.id||'整体';}
function definition(stage){if(stage.endsWith('.failed'))return [(definitions[stage.slice(0,-7)]?.[0]||'处理任务')+'失败','room','call'];return definitions[stage]||['其他处理','routing','call'];}
function work(row,unit){const v=row.units;if(unit==='byte')return size(v);if(unit==='audio')return `${num(v)} 秒音频`;if(unit==='unavailable')return '不可用';if(unit==='gauge')return '状态采样';return `${num(v,0)} ${{frame:'帧',gap:'帧缺口',tap:'滤波系数',channel:'声道',draw:'绘制调用',triangle:'三角形',packet:'音频包',call:'次'}[unit]||'次'}`;}
function highlighted(text,...keys){return {text,peak:snapshot.active&&keys.some(key=>snapshot.peakKeys?.includes(key)),records:keys.map(key=>snapshot.peakRecords?.[key]).filter(Boolean)};}
function setValue(el,value){
 if(value&&typeof value==='object'){
  const text=document.createElement('span');text.textContent=value.text;el.append(text);
  if(value.peak){text.classList.add('peak');text.title='达到本次监测峰值（不代表故障）';text.setAttribute('aria-label',value.text+'，本次峰值');}
  if(value.records?.length){const button=document.createElement('button');button.className='peak-info'+(value.peak?' peak':'');button.textContent='i';button.title='查看峰值对应的歌曲与时间';button.setAttribute('aria-label','查看峰值对应的歌曲与时间');button.onclick=()=>showPeakInfo(value.records);el.append(button);}
 }else el.textContent=String(value);
}
const peakNames={cpu:'CPU（单核基准）',memory:'内存',rx:'网络接收',tx:'网络发送',read:'读取速度',write:'写入速度',decode:'解码产出',hrtf:'对象双耳计算',room:'房间应用',latency:'解码到双耳输出',gaps:'音频缺口','3d':'3D 绘制'};
function peakName(record){return record.detail?`${definition(record.detail.stage)[0]} · ${source(record.detail)}`:(peakNames[record.key]||'处理峰值');}
function peakAmount(record){
 if(record.key.startsWith('work:'))return work({units:record.value},definition(record.detail.stage)[2]);
 if(record.key==='cpu')return num(record.value)+'%（100% = 一个核心）';
 if(['memory','rx','tx','read','write'].includes(record.key))return size(record.value)+(record.key==='memory'?'':' / 秒');
 if(record.key==='decode')return num(record.value)+' 秒音频 / 秒';
 if(record.key==='gaps')return ms(record.value/48);
 return ms(record.value);
}
function songTime(seconds){if(!finite(seconds))return '未测得';const minutes=Math.floor(seconds/60),rest=Math.floor(seconds%60);return `${minutes} 分 ${String(rest).padStart(2,'0')} 秒`;}
function showPeakInfo(records){
 const body=$('peak-content');body.replaceChildren();
 for(const record of records){
  const section=document.createElement('section'),heading=document.createElement('h3'),list=document.createElement('dl');heading.textContent=peakName(record);
  const p=record.playback;
  for(const [label,value] of [['歌曲',p?.title||'当时未收到歌曲信息'],['歌手',p?.artist||'未提供'],['歌曲位置',p?songTime(p.position):'无法确定'],['发生时刻',new Date(record.time).toLocaleString('zh-CN',{hour12:false})],['峰值',peakAmount(record)],['当时状态',p?(p.loading?'正在加载':p.paused?'已暂停':p.playing?'播放中':'未播放'):'未知']]){
   const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;list.append(dt,dd);
  }
  const note=document.createElement('p');note.className='hint';note.textContent=!p?'这次峰值没有可靠的歌曲上下文，不会套用当前歌曲。':p.uncertain?`播放进度在峰值前 ${num(p.ageMs/1000,1)} 秒最后更新，只能作为参考，无法确认精确歌曲位置。`:'这是峰值发生时的播放位置，约 1 秒采样精度；解码和渲染可能提前处理后面的音频。切歌不会更改这条记录。';
  section.append(heading,list,note);body.append(section);
 }
 if(!$('peak-dialog').open)$('peak-dialog').showModal();
}

function cells(target,rows){target.replaceChildren(...rows.map(row=>{const tr=document.createElement('tr');for(const value of row){const td=document.createElement('td');setValue(td,value);tr.append(td);}return tr;}));if(!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=8;td.className='empty';td.textContent='该期间尚无对应数据。播放音频或操作对应功能后会显示。';tr.append(td);target.append(tr);}}
function cards(target,rows){target.replaceChildren(...rows.map(([label,value,hint,onClick])=>{const el=document.createElement('div');el.className='card';if(onClick){el.dataset.clickable='';el.tabIndex=0;el.setAttribute('role','button');el.addEventListener('click',onClick);el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onClick();}});}const title=document.createElement('small'),v=document.createElement('div'),h=document.createElement('div');title.textContent=label;v.className='value';setValue(v,value);h.className='hint';h.textContent=hint;el.append(title,v,h);return el;}));}
function barColor(pct){return pct>80?'var(--bar-fill-hot)':pct>50?'var(--bar-fill-warn)':'var(--bar-fill)';}
let coreDialogOpen=false;
function renderCoreDialog(){
 if(!coreDialogOpen)return;
 const h=snapshot.hardware||{};const cores=h.perCoreCpu||[];const body=$('core-body');
 if(!cores.length)return;
 const total=h.totalMachinePercent!=null?`总 CPU ${num(h.totalMachinePercent)}% · `:'';
 // Update or create bars
 let summary=body.querySelector('.hint'),container=body.querySelector('.core-bars');
 if(!summary){body.replaceChildren();summary=document.createElement('p');summary.className='hint';container=document.createElement('div');container.className='core-bars';body.append(summary,container);}
 summary.textContent=`${total}${cores.length} 个逻辑核心 · 采样来自系统调度器 · 每秒刷新`;
 while(container.children.length>cores.length)container.lastChild.remove();
 for(let i=0;i<cores.length;i++){
  let row=container.children[i];
  if(!row){row=document.createElement('div');row.className='core-row';container.append(row);}
  const pct=cores[i];
  row.innerHTML=`<span class="core-label">核心 ${i}</span><div class="core-track"><div class="core-fill" style="width:${Math.min(100,pct).toFixed(1)}%;background:${barColor(pct)}"></div></div><span class="core-pct">${num(pct)}%</span>`;
 }
}
function showCoreDialog(){
 if(coreDialogOpen){$('core-dialog').close();return;}
 coreDialogOpen=true;
 renderCoreDialog();
 if(!$('core-dialog').open)$('core-dialog').showModal();
}
let snapshot={};
function render(){
 const s=snapshot,h=s.hardware||{},n=s.network||{},recent=s.active?[...(s.rows||[]),...(s.nativeRows||[])]:[];
 $('status').textContent=s.active?'后台记录中 · 每秒更新':'记录已暂停';$('toggle').textContent=s.active?'暂停记录':'继续记录';$('path').textContent=`自动保存：${s.directory||'等待目录'}`;
 cards($('cards'),[['CPU',highlighted(finite(h.totalMachinePercent)?num(h.totalMachinePercent)+'%':finite(h.cpuPercent)?num(h.cpuPercent)+'%（单核）':'等待采样','cpu'),'包含音频、界面与采集进程 · 点击查看各核心',showCoreDialog],['内存',highlighted(size(h.workingSetBytes),'memory'),'所有 SDA 进程工作集之和'],['网络 接收 / 发送',highlighted(`${size(n.rxBytesPerSecond)} / ${size(n.txBytesPerSecond)}`,'rx','tx'),'每秒传输；完整统计范围见下方说明'],['读取 / 写入',highlighted(`${size(h.readBytesPerSecond)} / ${size(h.writeBytesPerSecond)}`,'read','write'),'每秒文件与设备传输量']]);
 const select=stage=>recent.filter(r=>r.stage===stage),max=stage=>{const rows=select(stage);return rows.length?Math.max(...rows.map(r=>r.maxMs)):null;};
 const decoded=select('decode.output_audio').reduce((a,r)=>a+r.units,0)*1000/(s.intervalMs||1000),gaps=select('output.underrun_frames').reduce((a,r)=>a+r.units,0);
 const hrtf=recent.filter(r=>r.stage.startsWith('hrtf.object.')),slowest=hrtf.length?hrtf.reduce((a,b)=>a.maxMs>b.maxMs?a:b):null;
 cards($('flow'),[['解码产出',highlighted(`${num(decoded)} 秒音频 / 秒`,'decode'),decoded?'提前解码时可超过 1 秒':'本秒无产出；可能暂停、等待或已有缓存'],['对象双耳计算',highlighted(slowest?ms(slowest.maxMs):'尚无对象计算','hrtf'),slowest?`本秒单次最慢：${source(slowest)}`:'开启对象渲染并播放后显示'],['3D 绘制',highlighted(ms(max('3d.cpu_submit')),'3d'),recent.some(r=>r.stage==='3d.gpu_batch_elapsed')?`CPU 单帧最高 · GPU 批次：${ms(max('3d.gpu_batch_elapsed'))}（非单帧）`:`CPU 单帧最高 · GPU：${ms(max('3d.gpu_elapsed'))}`],['房间应用',highlighted(ms(max('room.apply_including_queue')),'room'),'本秒完成的任务，包含排队等待'],['解码到双耳输出',highlighted(ms(max('decode.to_binaural_callback_estimate')),'latency'),'本秒最高估算，不含蓝牙及耳机延迟'],['音频缺口',gaps?highlighted(`${num(gaps/48)} ms`,'gaps'):(s.nativeHeartbeatAgeMs==null?'尚无输出数据':s.nativeHeartbeatAgeMs>3000?'输出数据停止更新':'本秒未记录缺口'),'仅表示原生输出队列是否缺少音频']]);
 const alerts=[];if(s.mainHeartbeatAgeMs>3000)alerts.push('主进程已超过 3 秒未更新');if(s.main?.nativePid&&s.nativeHeartbeatAgeMs>3000)alerts.push('原生音频采样已超过 3 秒未更新');if(h.unavailable&&!Array.isArray(h.unavailable))alerts.push(`系统资源采样暂不可用：${h.unavailable}`);if(s.errors?.length)alerts.push('采集出现异常，详细原因已写入日志');if(s.dropped)alerts.push(`主进程采集丢失 ${s.dropped} 条记录`);if(gaps)alerts.push('本秒出现音频断供，请查看输出与解码耗时');
 $('health').textContent=alerts.length?alerts.join('；'):(s.active?'正在收集性能数据。复现卡顿后点击“导出日志”即可，无需选择保存位置。':'记录已暂停，已有日志仍保留。');$('health').className='notice'+(alerts.length?' warning':'');
 $('waits').textContent=(s.pending||[]).map(p=>`${definition(p.stage)[0]}：已等待 ${num(p.waitingMs/1000,1)} 秒`).join('；');
 const filter=$('filter').value.toLowerCase(),category=$('category').value;
 const rows=($('scope').value==='session'?(s.cumulative||[]):recent).filter(r=>!r.stage.endsWith('.begin')&&!r.stage.endsWith('.heartbeat')).filter(r=>(category==='all'||definition(r.stage)[1]===category)&&`${definition(r.stage)[0]} ${source(r)} ${r.stage} ${r.id}`.toLowerCase().includes(filter));
 cells($('stages'),rows.map(r=>{const [name,,unit]=definition(r.stage),counter=['byte','triangle','unavailable','gap','audio'].includes(unit)&&r.totalMs===0;return [name,source(r),num(r.count,0),counter?'—':ms(r.minMs),counter?'—':ms(r.totalMs/r.count),counter?'—':highlighted(ms(r.maxMs),'stage:'+r.stage+':'+r.id),counter?'—':ms(r.totalMs),highlighted(work(r,unit),'work:'+r.stage+':'+r.id)];}));
 cells($('processes'),(h.processes||[]).map(p=>[p.name,p.pid,finite(p.cpuPercent)?num(p.cpuPercent)+'%':'等待采样',size(p.workingSetBytes),size(p.readBytesPerSecond),size(p.writeBytesPerSecond)]));
 renderCoreDialog();
}
$('peak-close').onclick=()=>$('peak-dialog').close();$('peak-dialog').onclick=e=>{if(e.target===$('peak-dialog'))$('peak-dialog').close();};
$('core-close').onclick=()=>{$('core-dialog').close();coreDialogOpen=false;};
$('core-dialog').onclick=e=>{if(e.target===$('core-dialog')){$('core-dialog').close();coreDialogOpen=false;}};
$('core-dialog').addEventListener('close',()=>{coreDialogOpen=false;});
$('export').onclick=()=>window.performanceMonitor.action('export');$('toggle').onclick=()=>window.performanceMonitor.action('toggle');$('filter').oninput=render;$('scope').onchange=render;$('category').onchange=render;
async function tick(){try{snapshot=await window.performanceMonitor.snapshot();render();}catch{$('status').textContent='窗口暂未收到更新，后台仍可能在记录';}setTimeout(tick,1000);}tick();
// Same lens geometry and strength as SheetHeading / GlassRefraction.
{
 const dialog=$('peak-dialog'),heading=dialog.querySelector('.dialog-head');
 dialog.addEventListener('scroll',()=>heading.style.setProperty('--sheet-scroll',String(Math.min(1,Math.max(0,dialog.scrollTop)/32))),{passive:true});
 const canvas=document.createElement('canvas');canvas.width=44;canvas.height=44;
 const context=canvas.getContext('2d'),pixels=context.createImageData(44,44);
 for(let y=0;y<44;y++)for(let x=0;x<44;x++){
  const px=x+.5-22,py=y+.5-22,qx=Math.abs(px),qy=Math.abs(py),length=Math.hypot(qx,qy);
  const depth=22-length,t=Math.max(0,Math.min(1,depth/(44*.48))),bend=16*t*t*(1-t)*(1-t);
  const i=(y*44+x)*4;
  pixels.data[i]=Math.round(127.5-Math.sign(px)*(length?qx/length:0)*bend*110);
  pixels.data[i+1]=Math.round(127.5-Math.sign(py)*(length?qy/length:0)*bend*110);
  pixels.data[i+2]=128;pixels.data[i+3]=255;
 }
 context.putImageData(pixels,0,0);$('peak-lens').setAttribute('href',canvas.toDataURL());
 $('peak-close').querySelector('.mp-refraction').style.backdropFilter='url("#peak-glass")';
}
$('simulate').onclick=async()=>{
 const button=$('simulate'),panel=$('simulation-result');button.disabled=true;panel.hidden=false;
 panel.textContent='正在用当前渲染器模拟计算负载，不会播放声音…';
 try{
  const result=await window.performanceMonitor.action('simulate');
  if(!result){panel.hidden=true;return;}if(result.error){panel.textContent=result.error;return;}
  panel.replaceChildren();
  const add=text=>{const p=document.createElement('p');p.textContent=text;panel.append(p);};
  add(`原机 ${result.source.platform} / ${result.source.arch} → 本机 ${result.current.platform} / ${result.current.arch}。原机等效耗时倍率 ${result.scale.toFixed(2)}（估算）。`);
  add(`抽样 ${result.testedSnapshots} / ${result.availableSnapshots} 个负载快照${result.traceTruncated?'；日志已截断，仅覆盖最近部分':''}${result.traceDropped?'；采集中存在丢失事件':''}。`);
  for(const row of result.rows)add(row.error?`${new Date(row.time).toLocaleTimeString()}：未完成，${row.error}`:`${new Date(row.time).toLocaleTimeString()}：${row.measured.sources} 路声音，原日志实测 ${row.observedMeanBlockMs==null?'未记录':row.observedMeanBlockMs.toFixed(2)+' ms'}（与合成负载不完全等价）；每块本机 ${row.measured.meanBlockMs.toFixed(2)} ms，原机等效平均 ${row.equivalentMeanMs.toFixed(2)} ms / P95 ${row.equivalentP95Ms.toFixed(2)} ms；实时预算 ${row.measured.blockBudgetMs.toFixed(2)} ms。`);
  result.limitations.forEach(add);add(`结果：${result.path}`);
 }catch(error){panel.textContent=String(error);}finally{button.disabled=false;}
};
$('verify-codec').onclick=async()=>{
 const button=$('verify-codec'),panel=$('simulation-result');button.disabled=true;panel.hidden=false;panel.textContent='正在隔离进程中构造测试包并执行当前解析器，不读取或播放歌曲…';
 try{const result=await window.performanceMonitor.action('verify-codec');if(!result){panel.hidden=true;return;}if(result.error){panel.textContent=result.error;return;}
 panel.replaceChildren();const add=text=>{const p=document.createElement('p');p.textContent=text;panel.append(p);};
 add('解码错误路径验证 · 使用人工生成数据');
 const names={'matching-failure-signature':'命中检查点及错误指纹','checkpoint-only':'仅命中检查点，未确认相同错误','not-reproduced':'未复现，不能据此认定已修复',unsupported:'尚无对应的合成用例'};
 const checkpoints={'auto.sync_not_found':'格式识别：找不到同步头','ac4.truncated_sync_frame':'AC-4：输入结束时帧不完整','mpegh.mhas.packet_too_large':'360RA / MPEG-H：包长度超限','iamf.leb.unterminated':'IAMF：整数编码未结束','iamf.leb.overflow':'IAMF：整数溢出'};
 for(const row of result.results)add(`${checkpoints[row.checkpoint]||row.checkpoint}：${names[row.status]||row.status}（${row.attempts} 个测试输入）。`);
 add('命中错误路径不代表已重现原歌曲的全部缺陷。测试不包含原始音频、驱动或播放输出。');add(`结果：${result.path}`);
 }catch(error){panel.textContent=String(error);}finally{button.disabled=false;}
};

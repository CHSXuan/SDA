const clone = value => JSON.parse(JSON.stringify(value));
const roomOnly = settings => { const {monitor, ...room} = settings; return room; };
const audioActions=new Set(['roomApply','roomDisable','roomSettings','monitorSettings','monitorAlign','monitorPreset','hardwarePreset','hrtf','hrtfTune']);
export function settingsWaitView(wait,playback){
  if(!wait||!playback||wait.track!==playback.track)return null;
  const remaining=Math.max(0,wait.until-playback.position);
  if(remaining<=0)return null;
  return playback.running?`等待音效切换 · 预计还需 ${Math.ceil(remaining)} 秒`:'设置已提交 · 继续播放后等待缓存音频切换';
}
function el(tag, text, cls) { const node=document.createElement(tag); if(text)node.textContent=text; if(cls)node.className=cls; return node; }
export function createTools(send,request,getPlayback=()=>null) {
  const dialog=document.getElementById("sound-tools"), content=document.getElementById("tools-content"), note=document.getElementById("tools-note");
  let state=null, online=false, page="room", draft=null, expected="", dirty=false, pending=null, signature="";
  let pendingAction="",draftProfileId=null;
  let audioWait=null;
  note.setAttribute('role','status');note.setAttribute('aria-live','polite');
  const cancelGeneration=document.getElementById("tools-cancel-generation");
  cancelGeneration.onclick=()=>{send("roomCancel");report("正在取消房间生成…");};
  const report=text=>{if(note.textContent!==text)note.textContent=text;};
  function playbackProgress(){
    if(!audioWait)return;
    const text=settingsWaitView(audioWait,getPlayback());
    if(text){note.setAttribute('aria-busy','true');report(text);}
    else {audioWait=null;note.removeAttribute('aria-busy');report('主机已应用');}
  }
  function issue(action,value) {
    if(pending||!online)return;
    const id=send(action,value);
    if(!id){report("尚未连接主机");return;}
    audioWait=null;note.setAttribute('aria-busy','true');pending=id;pendingAction=action;cancelGeneration.hidden=action!=="roomGenerate";report(action==="roomGenerate"?"主机正在生成房间…":"等待主机应用…");lock();
  }
  function lock() {
    for(const control of content.querySelectorAll("button,input"))control.disabled=!online||!!pending||!!state?.locked;
  }
  function button(text,fn,primary=false) { const b=el("button",text,primary?"primary":"");b.type="button";b.onclick=fn;return b; }
  function fresh() {
    if(!state)return;
    if(page==="room")draftProfileId=state.cinema.profileId;
    draft=clone(page==="room"?roomOnly(state.cinema.settings):page==="monitor"?state.cinema.settings.monitor:{head:state.head,dense:state.dense,calibrated:state.calibrated});
    expected=JSON.stringify(page==="room"?{profileId:state.cinema.profileId,settings:draft}:draft);
    dirty=false;render();
  }
  function summary(name,description){
    const panel=el("div",null,"ear-current");panel.append(el("span","当前状态","ear-eyebrow"),el("strong",name),el("span",description,"ear-description"));content.append(panel);
  }
  function cards(title){const group=el("section",null,"ear-group"),list=el("div",null,"ear-list");group.append(el("h3",title),list);content.append(group);return list;}
  function card(list,name,description,selected,choose){
    const row=button("",()=>{if(!selected)choose();});row.className="ear-profile";row.setAttribute("aria-pressed",String(!!selected));
    const label=el("span",null,"ear-profile-label");label.append(el("strong",name),el("small",selected?"正在使用":description));
    const check=el("span",selected?"✓":"›","ear-indicator");check.setAttribute("aria-hidden","true");row.append(label,check);list.append(row);
  }
  function render() {
    dialog.dataset.page=page;
    content.replaceChildren();if(!state){content.append(el("p","正在读取主机音频设置…"));return;}
    document.getElementById("tools-title").textContent={room:"房间",monitor:"监听",hrtf:"耳廓"}[page];
    const header=el("p",page==="hrtf"?"选择耳廓档案，由电脑渲染并同步到此设备。":`${state.layout} · 修改在主机生效`,"muted");content.append(header);
    if(page==="room") {
      const settings=state.cinema.settings,active=state.rooms.find(r=>r.id===state.cinema.profileId);
      summary(settings.enabled?(active?.name||"自定义房间"):"房间已关闭",`${state.layout} · ${settings.enabled?"已启用":"未启用"}`);
      const off=cards("播放模式");card(off,"关闭房间","仅关闭房间仿真",!settings.enabled,()=>issue("roomDisable"));
      for(const builtin of [true,false]){
        const rooms=state.rooms.filter(r=>r.layout===state.layout&&!!r.builtin===builtin);
        const list=cards(builtin?"内置房间":"个人房间");
        if(!rooms.length)list.append(el("p",builtin?"当前布局暂无内置房间。":"暂无个人房间，可在电脑端创建。","ear-empty"));
        for(const room of rooms)card(list,room.name,`${room.layout} · 点击切换`,settings.enabled&&room.id===state.cinema.profileId,()=>issue("roomApply",room.id));
      }
      lock();return;
    } else if(page==="monitor") {
      const monitor=state.cinema.settings.monitor;
      summary(monitor.enabled?"监听已启用":"监听已关闭",`${state.layout} · ${monitor.hardware?.enabled?"硬件链路已启用":"硬件链路未启用"}`);
      const update=patch=>issue("monitorSettings",{settings:{...clone(monitor),...patch},expected:JSON.stringify(monitor)});
      const modes=cards("监听状态");
      card(modes,"启用监听","使用电脑端当前配置",monitor.enabled,()=>update({enabled:true}));
      card(modes,"关闭监听","停用监听处理器",!monitor.enabled,()=>update({enabled:false}));
      const presets=cards("内置监听配置");
      card(presets,"透明监听","全频输出",false,()=>issue("monitorPreset","transparent"));
      if(state.speakers.some(s=>s.name==="LFE"))card(presets,"低频管理","80 Hz 分频",false,()=>issue("monitorPreset","bass-80"));
      const hardware=cards("硬件链路配置");
      for(const [id,name,detail] of [["ahb2-high","AHB2 · 高增益","2 Vrms 线路输出"],["ahb2-mid","AHB2 · 中增益","4 Vrms 线路输出"],["ahb2-low","AHB2 · 低增益","9.8 Vrms 线路输出"]])card(hardware,name,detail,false,()=>issue("hardwarePreset",id));
      const details=el("details",null,"sound-readonly");details.append(el("summary","当前配置详情"));
      for(const [label,value] of [["监听衰减",`${monitor.levelDb} dB`],["DIM",monitor.dim?`${monitor.dimDb} dB`:"关闭"],["总静音",monitor.muted?"开启":"关闭"],["低频管理",monitor.bassEnabled?`${monitor.crossoverHz} Hz`:"关闭"],["输入增益",`${monitor.hardware?.inputDb??0} dB`],["功放增益",`${monitor.hardware?.gainDb??0} dB`]]){
        const row=el("div",null,"sound-detail-row");row.append(el("span",label),el("strong",value));details.append(row);
      }
      content.append(details);lock();return;
    } else {
      const active=state.heads.find(h=>h.id===state.head);
      const current=el("div",null,"ear-current");
      current.append(el("span","当前使用","ear-eyebrow"),el("strong",active?.name||"未选择档案"),el("span",state.head.startsWith("personal-")?"个人耳廓":"内置测量档案","ear-description"));
      content.append(current);
      for(const personal of [true,false]){
        const heads=state.heads.filter(h=>h.id.startsWith("personal-")===personal);
        const group=el("section",null,"ear-group");
        const title=el("h3",personal?"个人档案":"内置测量库");title.append(el("span",String(heads.length)));group.append(title);
        if(!heads.length)group.append(el("p","暂无个人档案，可在电脑端创建。","ear-empty"));
        const list=el("div",null,"ear-list");
        for(const head of heads){
          const selected=head.id===state.head;
          const row=button("",()=>{if(!selected)issue("hrtf",head.id);});row.className="ear-profile";row.setAttribute("aria-pressed",String(selected));
          const icon=el("span",personal?"◉":"◎","ear-icon");icon.setAttribute("aria-hidden","true");
          const label=el("span",null,"ear-profile-label");label.append(el("strong",head.name),el("small",selected?"正在使用":"点击切换"));
          const indicator=el("span",selected?"✓":"","ear-indicator");indicator.setAttribute("aria-hidden","true");row.append(icon,label,indicator);list.append(row);
        }
        group.append(list);content.append(group);
      }
      lock();return;
    }

  }
  document.getElementById("tools-close").onclick=()=>dialog.close();
  dialog.addEventListener("click",e=>{if(e.target===dialog)dialog.close();});
  for(const b of document.querySelectorAll("[data-tool]"))b.onclick=()=>{document.getElementById("player-settings").dispatchEvent(new Event("menu-close"));if(page!==b.dataset.tool){page=b.dataset.tool;fresh();report("");}else if(!draft)fresh();if(!dialog.open)dialog.showModal();};
  return {
    playbackProgress,
    update(next,connected,isPlaying=false) {
      online=connected;for(const b of document.querySelectorAll("[data-tool]"))b.disabled=!connected||!next;
      if(!next){state=null;lock();return;}
      const changed=JSON.stringify(next)!==signature;signature=JSON.stringify(next);state=next;
      if(changed&&!dirty&&!pending)fresh();else lock();
      if(next.locked)report("主机正在切换音频或对照试听，请稍候");
      else if(pendingAction==="roomGenerate"&&next.generator?.running)report(`主机正在生成房间 · ${next.generator.current} / ${next.generator.total}`);
      else if(next.error)report(next.error);
    },
    acknowledged(id,error,data) {
      if(id!==pending)return;pending=null;const action=pendingAction;pendingAction="";cancelGeneration.hidden=true;note.removeAttribute('aria-busy');
      if(!error){dirty=false;fresh();}
      const playback=getPlayback();
      if(!error&&audioActions.has(action)&&playback?.hasTrack){
        // Estimate the old rendered audio still in flight, not a wall-clock
        // timer: pausing/rebuffering must not declare a setting audible.
        const delay=Number.isFinite(data?.effectPendingSeconds)?Math.min(15,Math.max(0,data.effectPendingSeconds)):8;
        audioWait={track:playback.track,until:Math.max(playback.position,playback.hostPosition)+delay};
        playbackProgress();
      }else report(error||(action==="roomGenerate"?"房间已生成，请从档案中选择应用":"主机已应用"));
      lock();
    },
    disconnected() {audioWait=null;note.removeAttribute('aria-busy');cancelGeneration.hidden=true;pendingAction="";pending=null;online=false;lock();report("连接已断开，重新连接后可继续编辑");for(const b of document.querySelectorAll("[data-tool]"))b.disabled=true;},
  };
}

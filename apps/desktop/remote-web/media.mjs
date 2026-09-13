import Swiper from './swiper.mjs';
export function createMediaPicker(request){
 const $=id=>document.getElementById(id),dialog=$('media-picker'),content=$('media-content'),note=$('media-note');let history=[],current=null,busy=false,revision=0,swiper=null,rootPage=0;
 function setTitle(text,direction=1,animate=false){
  const heading=$('media-title'),previous=heading.getAttribute('aria-label')||heading.textContent;
  if(previous===text)return;
  heading.getAnimations({subtree:true}).forEach(animation=>animation.cancel());
  heading.setAttribute('aria-label',text);heading.replaceChildren();
  const next=document.createElement('span');next.textContent=text;next.className='media-title-text';heading.append(next);
  if(!animate||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const old=document.createElement('span');old.textContent=previous;old.className='media-title-text';old.setAttribute('aria-hidden','true');heading.prepend(old);
  const options={duration:320,easing:'cubic-bezier(.22,.7,.2,1)',fill:'both'};
  old.animate([{opacity:1,transform:'translateX(0)'},{opacity:0,transform:`translateX(${-direction*14}px)`}],options).finished.then(()=>old.remove(),()=>old.remove());
  next.animate([{opacity:0,transform:`translateX(${direction*14}px)`},{opacity:1,transform:'translateX(0)'}],options);
 }
 function destroyPages(){swiper?.destroy(true,true);swiper=null;}
 function button(text,action){const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=action;return b;}
 function state(value){busy=value;dialog.setAttribute('aria-busy',String(value));for(const b of dialog.querySelectorAll('button:not(#media-close)'))b.disabled=value;}
 async function add(id){if(busy)return;const version=++revision;state(true);note.textContent='正在加入主机播放列表…';try{await request('mediaOpen',id);if(version===revision)note.textContent='已加入主机播放列表';}catch(e){if(version===revision)note.textContent=e.message;}finally{if(version===revision)state(false);}}
 async function load(id=null,back=false){if(busy)return;const version=++revision;state(true);note.textContent='正在读取…';try{const data=await request('mediaList',id);if(version!==revision)return;
 if(!back&&current!==id)history.push(current);current=id;dialog.dataset.mediaRoot=String(!id);dialog.scrollTop=0;destroyPages();content.replaceChildren();$('media-back').hidden=!id;$('media-add').hidden=!id;if(id)setTitle(data.name||'主机媒体');
 function rows(entries,target=content){if(!entries.length){const p=document.createElement('p');p.className='muted';p.textContent='暂无记录';target.append(p);return;}for(const entry of entries){const b=button('',()=>entry.directory?void load(entry.id):void add(entry.id));b.className='media-row';const icon=document.createElement('span');icon.className='media-kind';icon.textContent=entry.directory?'▱':'♪';icon.ariaHidden='true';const name=document.createElement('span');name.textContent=entry.name;const detail=document.createElement('small');detail.textContent=entry.directory?'打开 ›':'加入列表';b.append(icon,name,detail);target.append(b);}}
 if(id)rows(data.entries);else {
 const dots=document.createElement('div');dots.className='media-page-dots';dots.setAttribute('aria-label','媒体分页');
 const viewport=document.createElement('div');viewport.className='swiper media-pages';const wrapper=document.createElement('div');wrapper.className='swiper-wrapper';viewport.append(wrapper);content.append(viewport,dots);
 const panels=[],buttons=[];
 for(const [index,[title,entries]] of [['收藏',data.favorites],['最近打开',data.recent]].entries()){
  const dot=button('',()=>swiper?.slideTo(index));dot.setAttribute('aria-label',title);buttons.push(dot);dots.append(dot);
  const panel=document.createElement('section');panel.className='swiper-slide media-page';panel.setAttribute('aria-label',title);panels.push(panel);wrapper.append(panel);rows(entries,panel);
 }
 const selected=(index,animate=true)=>{const direction=index>=rootPage?1:-1;rootPage=index;setTitle(index===0?'收藏':'最近打开',direction,animate);panels.forEach((panel,i)=>{panel.inert=i!==index;panel.setAttribute('aria-hidden',String(i!==index));buttons[i].setAttribute('aria-pressed',String(i===index));});dialog.dispatchEvent(new Event('scroll'));};
 swiper=new Swiper(viewport,{initialSlide:rootPage,spaceBetween:16,speed:matchMedia('(prefers-reduced-motion: reduce)').matches?0:280,threshold:12,touchAngle:30,on:{slideChange:s=>selected(s.activeIndex)}});selected(rootPage,false);
 }
 dialog.dispatchEvent(new Event('scroll'));
 note.textContent=id?'仅显示支持的媒体文件':'只查看主机的收藏和最近目录';
 }catch(e){if(version===revision)note.textContent=e.message;}finally{if(version===revision)state(false);}}
 $('media-open').onclick=()=>{$('player-settings').dispatchEvent(new Event('menu-close'));history=[];current=null;rootPage=0;setTitle('收藏');dialog.showModal();void load();};
 $('media-close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{revision++;busy=false;destroyPages();});
 $('media-back').onclick=()=>void load(history.pop()??null,true);$('media-add').onclick=()=>void add(current);
 return {close:()=>dialog.close()};
}

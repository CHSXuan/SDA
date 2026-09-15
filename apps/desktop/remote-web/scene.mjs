// Poll only while this page is visible. Audio transport is independent.
export function createScene(request){
 const panel=document.getElementById('scene-section'),host=document.getElementById('scene-host'),status=document.getElementById('scene-status');
 const button=document.getElementById('scene-layout-button'),menu=document.getElementById('scene-layout-options');
 let selection=null,busy=false,allowed=false;
 const close=()=>{menu.hidden=true;button.setAttribute('aria-expanded','false');};
 button.onclick=()=>{menu.hidden=!menu.hidden;button.setAttribute('aria-expanded',String(!menu.hidden));};
 document.addEventListener('click',e=>{if(!e.target.closest('.scene-layout'))close();});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
 function updateLayout(value,canControl){
   selection=value;allowed=canControl;
   button.disabled=busy||!allowed||!value||value.locked;
   button.textContent=(value?.options.find(o=>o.value===value.value)?.label??'布局')+' ▾';
   const key=JSON.stringify(value);
   if(menu.dataset.key===key)return;
   menu.dataset.key=key;menu.replaceChildren();
   for(const option of value?.options??[]){
     const item=document.createElement('button');item.type='button';item.role='option';
     item.textContent=option.label+(option.value===value.value?'  ✓':'');item.setAttribute('aria-selected',String(option.value===value.value));
     item.onclick=async()=>{if(busy||!allowed||selection?.locked)return;close();busy=true;button.disabled=true;
       try{await request('layout',option.value);}catch(error){status.textContent=error.message;}finally{busy=false;updateLayout(selection,allowed);}};
     menu.append(item);
   }
 }
 let active=false,online=false,view=null,timer=0,generation=0,last=null,loader=null;
 const theme=()=>document.documentElement.dataset.theme==='light'?'light':'dark';
 async function poll(epoch){
   try{
     const scene=await request('scene');
     if(epoch!==generation)return;
     if(scene&&Array.isArray(scene.objects)&&Array.isArray(scene.layout)){
       if(!view){loader??=import('./scene-view.mjs');const module=await loader;if(epoch!==generation)return;view=module.mountScene(host);}
       last=scene;view.update(scene,theme());status.textContent=`${scene.spherical?'360° 球形声场':'方形声场'} · ${scene.objects.length} 个对象`;
     }else status.textContent='等待主机的空间信息';
   }catch{if(epoch===generation)status.textContent='空间视图暂不可用，音频不受影响';}
   finally{if(epoch===generation)timer=setTimeout(()=>void poll(epoch),100);}
 }
 function refresh(){
   generation++;clearTimeout(timer);
   if(active&&online&&!document.hidden){status.textContent='加载空间视图…';void poll(generation);}
   else{view?.dispose();view=null;last=null;host.replaceChildren();}
 }
 document.addEventListener('sda-page',e=>{const next=e.detail===2;if(next!==active){active=next;refresh();}});
 document.addEventListener('visibilitychange',refresh);
 new MutationObserver(()=>{if(view&&last)view.update(last,theme());}).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
 return {updateLayout,connected(value){if(online!==value){online=value;if(!value){close();updateLayout(selection,false);}refresh();}},reset(){last=null;view?.dispose();view=null;host.replaceChildren();}};
}

const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('performanceMonitor',{snapshot:()=>ipcRenderer.invoke('sda:performance-snapshot'),action:a=>ipcRenderer.invoke('sda:performance-action',a)});

ipcRenderer.on('sda:performance-notice',(_event,text)=>{
 const el=document.createElement('div');el.textContent=text;
 Object.assign(el.style,{position:'fixed',top:'16px',left:'50%',transform:'translateX(-50%)',zIndex:'9999',background:'#253047',color:'white',padding:'12px 20px',borderRadius:'12px',maxWidth:'90%',overflowWrap:'anywhere',pointerEvents:'none'});
 document.body.append(el);setTimeout(()=>el.remove(),8000);
});

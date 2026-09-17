const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const app=fs.readFileSync(require.resolve('../remote-web/app.mjs'),'utf8');
function setup(owner){
 const callbacks=[],sent=[],elements={},scope={session:owner,document:{hidden:false},WebSocket:{OPEN:1},Date,clearTimeout(){},setTimeout(fn,delay){callbacks.push({fn,delay});return callbacks.length;},controlResults:new Map(),soundTools:{disconnected(){}},setControls(){},updateSystemPlayback(){},message(){},stats(){},$:id=>elements[id]??={},send:(...args)=>sent.push(args),openPcmSocket:o=>{scope.opened=o;},playback:{playing:false,paused:true},openHlsControl(){throw Error('not HLS');}};
 vm.createContext(scope);
 vm.runInContext(app.slice(app.indexOf('function recoverPcm('),app.indexOf('function openPcmSocket(')),scope);
 vm.runInContext(app.slice(app.indexOf('function retainBackgroundSession('),app.indexOf('window.addEventListener("pagehide",retainBackgroundSession)')),scope);
 vm.runInContext(app.slice(app.indexOf('function restoreForegroundConnection('),app.indexOf('window.addEventListener("pageshow",restoreForegroundConnection)')),scope);
 return {scope,callbacks,sent};
}
test('paused controller reconnects on foreground without AudioContext or playback commands',()=>{
 const carrier={paused:true},owner={controlOnly:true,ready:true,lastHost:Date.now()-60000,pending:new Map(),key:'retained',controlMedia:carrier,socket:{readyState:1,close(){}}};
 const {scope,callbacks,sent}=setup(owner);scope.restoreForegroundConnection();
 assert.equal(scope.session,owner);assert.equal(owner.key,'retained');assert.equal(owner.controlMedia,carrier);assert.equal(carrier.paused,true);assert.equal(callbacks[0].delay,5000);
 callbacks[0].fn();callbacks[1].fn();assert.equal(scope.opened,owner);assert.equal(sent[0][1].background,false);
});
test('healthy controller is probed without restarting playback or reconnecting',()=>{
 const owner={controlOnly:true,ready:true,lastHost:Date.now(),socket:{readyState:1}};
 const {scope,callbacks,sent}=setup(owner);scope.restoreForegroundConnection();assert.equal(callbacks.length,1);assert.equal(callbacks[0].delay,5000);assert.equal(sent[0][0],'K');
});
test('repeated transport failures preserve session with bounded backoff; explicit stop prevents reopening',()=>{
 const owner={controlOnly:true,pending:new Map(),reconnectAttempts:50};const {scope,callbacks}=setup(owner);
 scope.recoverPcm(owner);assert.equal(scope.session,owner);assert.equal(callbacks[0].delay,8000);
 owner.closed=true;scope.session=null;callbacks[0].fn();assert.equal(scope.opened,undefined);
});
test('hidden page does not trigger foreground recovery',()=>{
 const owner={controlOnly:true};const {scope,callbacks}=setup(owner);scope.document.hidden=true;scope.restoreForegroundConnection();assert.equal(callbacks.length,0);
});

test('background notification requests grace without changing playback',()=>{
 const owner={controlOnly:true,ready:true};const {scope,sent}=setup(owner);scope.document.hidden=true;scope.restoreForegroundConnection();assert.equal(sent[0][1].background,true);
});
test('host controller grace expires and foreground restores normal timeout',async()=>{
 const source=fs.readFileSync(require.resolve('../remote-session.cjs'),'utf8');let now=100000,tick,incoming;const failed=[];
 const scope={Date:{now:()=>now},setInterval:fn=>{tick=fn;return {unref(){}};},clearInterval(){},decodePackets:fn=>{incoming=fn;return ()=>{};},readJson:v=>v,packet:()=>Buffer.alloc(0)};
 vm.createContext(scope);vm.runInContext('class Host {'+source.slice(source.indexOf('  async attachController('),source.indexOf('  async attachHost('))+'};this.Host=Host;',scope);
 const host=new scope.Host();Object.assign(host,{reservePeer:()=>true,hooks:{},generation:1,publish(){},failPeer:(s,e)=>failed.push(e)});
 const socket={on(){},once(){},write(){}};await host.attachController(socket,1);incoming('H',{protocol:1});incoming('K',{background:true});
 now+=60000;tick();assert.equal(failed.length,0,'background remains connected beyond 15 seconds');
 incoming('K',{background:false});now+=16000;tick();assert.equal(failed.length,1,'foreground uses normal heartbeat limit');
 failed.length=0;incoming('K',{background:true});now+=300001;tick();assert.equal(failed.length,1,'grace is bounded');
});

test('pagehide retains paused carrier and session without explicit logout',()=>{
 const media={paused:true},owner={controlOnly:true,ready:true,controlMedia:media,mediaActivated:true};
 const {scope,sent}=setup(owner);scope.retainBackgroundSession();
 assert.equal(scope.session,owner);assert.equal(owner.closed,undefined);assert.equal(owner.controlMedia,media);assert.equal(owner.mediaActivated,true);assert.equal(sent[0][1].background,true);
});

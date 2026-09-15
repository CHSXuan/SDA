import test from 'node:test';
import assert from 'node:assert/strict';
import {ConnectionWatchdog} from '../remote-web/connection-watchdog.mjs';
test('background suspension and delayed callbacks probe before disconnecting',()=>{
 const w=new ConnectionWatchdog();assert.equal(w.check(1000,1000,false),'alive');
 assert.equal(w.check(61000,1000,true),'background');
 assert.equal(w.check(62000,1000,false),'probing');
 assert.equal(w.check(63000,63000,false),'alive');
});
test('a genuinely silent connection expires after the probe grace',()=>{
 const w=new ConnectionWatchdog();w.check(1000,1000,false);
 assert.equal(w.check(17000,1000,false),'probing');
 for(let now=18000;now<27000;now+=1000)assert.equal(w.check(now,1000,false),'probing');
 assert.equal(w.check(27000,1000,false),'expired');
});

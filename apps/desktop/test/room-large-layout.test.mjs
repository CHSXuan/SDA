import assert from 'node:assert/strict';
import {validateConfig} from '../room-lab.cjs';
import {validateRoom} from '../cinema-profiles.cjs';
for (const [layout, count] of [['11.1.8',19],['360RA-13',13],['22.2',22],['9.1.2',11],['7.1.4',11]]) {
  const config=validateConfig({layout,length:6,width:5,height:3.2,earHeight:1.2,placement:.7,material:'studio',order:10});
  assert.equal(config.speakers.length,count);
  const impulse=Array(512).fill(0); impulse[0]=.1;
  const profile={version:1,sampleRate:48000,layout,name:'Validation fixture',source:'test',license:'test',measurement:'personal',speakers:config.speakers.map(s=>({...s,onsetSample:0,directLeft:impulse,directRight:impulse,roomLeft:impulse,roomRight:impulse}))};
  assert.equal(validateRoom(profile).speakers.length,count);
  const missing=structuredClone(profile);missing.speakers.pop();assert.throws(()=>validateRoom(missing),/全部非 LFE/);
  const duplicate=structuredClone(profile);duplicate.speakers[0]=duplicate.speakers[1];assert.throws(()=>validateRoom(duplicate),/全部非 LFE/);
  const angle=structuredClone(profile);angle.speakers[0].azimuth+=10;assert.throws(()=>validateRoom(angle),/方向/);
}
console.log('Room layout coverage and direction regression passed');

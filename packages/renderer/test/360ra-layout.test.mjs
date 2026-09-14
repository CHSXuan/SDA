import assert from 'node:assert/strict';
import {LAYOUTS} from '../src/layouts.ts';
import {VbapSolver} from '../src/vbap.ts';
import {SpatialRenderer} from '../src/renderer.ts';
const layout=LAYOUTS['360RA-13'];
assert.equal(layout.length,13);
assert.deepEqual([-20,0,30].map(el=>layout.filter(s=>s.elevation===el).length),[3,5,5]);
const solver=new VbapSolver(layout);
for(const [i,speaker] of layout.entries())assert.ok(solver.pan(speaker)[i]>.999,speaker.name);
const renderer=new SpatialRenderer({}, {layout});
assert.ok(renderer.topology.length>32);
for(const candidate of Object.values(LAYOUTS)) {
 renderer.layout=candidate;renderer.renderLayout=candidate;
 assert.ok([...renderer.buildRenderProjection()].every(i=>i>=0));
}
console.log('360RA speaker routing and all layout bus mappings passed');

const standard=LAYOUTS['22.2'];
assert.equal(standard.filter(s=>s.isLfe).length,2);
assert.deepEqual([0,1,-1].map(sign=>standard.filter(s=>!s.isLfe&&Math.sign(s.elevation)===sign).length),[10,9,3]);
const standardSolver=new VbapSolver(standard);
for(const [i,s] of standard.entries())if(!s.isLfe)assert.ok(standardSolver.pan(s)[i]>.999,s.name);

const atmos=LAYOUTS["11.1.8"];
assert.equal(atmos.length,20);
assert.equal(atmos.filter(s=>s.isLfe).length,1);
assert.equal(atmos.filter(s=>!s.isLfe&&s.elevation===0).length,11);
assert.equal(atmos.filter(s=>s.elevation>0).length,8);
const atmosSolver=new VbapSolver(atmos);
for(const [i,s] of atmos.entries())if(!s.isLfe)assert.ok(atmosSolver.pan(s)[i]>.999,s.name);

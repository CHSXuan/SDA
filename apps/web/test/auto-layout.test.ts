import assert from "node:assert/strict";
import {formatAutoLayout,resolveAutoLayout,uses360RaLowerLayer} from "../src/auto-layout";
for(const codec of ["mpegh","mha1","mhm1"]){
  assert.equal(uses360RaLowerLayer(codec),true);
  assert.equal(resolveAutoLayout(["L","R"],false,codec),"360RA-13");
  assert.equal(resolveAutoLayout(["Obj_0"],true,codec),"360RA-13");
}
assert.equal(uses360RaLowerLayer("eac3"),false);
for(const codec of ["eac3","truehd","ac4"]){
  assert.equal(resolveAutoLayout(["WideLeft","TopMiddleLeft","TopRearLeft"],true,codec),"7.1.4");
  assert.equal(resolveAutoLayout(["L","R","C"],false,codec),"7.1.4");
}
assert.equal(formatAutoLayout("bwf"),undefined);
assert.equal(resolveAutoLayout(["L","R","C","Ls","Rs"],false,"dts"),"5.1");
console.log("Format defaults: Dolby 7.1.4, MPEG-H 360RA-13, other formats preserved");

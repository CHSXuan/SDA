const names = ['Surround1Left','Surround1Right','FrontHeightLeft','FrontHeightRight','RearHeightLeft','RearHeightRight','I_M_L060','I_M_R060','I_M_000','I_M_L135','I_M_R135','I_M_L030','I_M_R030','I_M_180','LFE2','I_M_L090','I_M_R090','I_U_L045','I_U_R045','I_U_000','I_T_000','I_U_L135','I_U_R135','I_U_L090','I_U_R090','I_U_180','I_L_000','I_L_L045','I_L_R045','UpperFrontLeft','UpperFrontRight','UpperCenter','UpperRearLeft','UpperRearRight','LowerFrontLeft','LowerFrontRight','LowerCenter','FrontLeft','FrontRight','Center','LFE','WideLeft','WideRight','SurroundLeft','SurroundRight','RearLeft','RearRight','TopFrontLeft','TopFrontRight','TopMiddleLeft','TopMiddleRight','TopRearLeft','TopRearRight'];
const defaults = () => ({enabled:false,levelDb:0,dim:false,dimDb:-20,muted:false,bassEnabled:false,crossoverHz:80,bassDb:0,outputs:{}});
const hardwareDefaults = () => ({enabled:false,inputDb:0,dacBits:24,lineRms:2,gainDb:26,railV:28,currentA:7,loadOhms:8,outputOhms:0.05,bandwidthHz:60000});
function validate(value) {
  const v = value ?? defaults();
  const bounded = (x, min, max) => typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max;
  if (!v || ['enabled','dim','muted','bassEnabled'].some(k=>typeof v[k] !== 'boolean')
    || !bounded(v.levelDb,-80,0) || !bounded(v.dimDb,-40,0) || !bounded(v.crossoverHz,40,160)
    || !bounded(v.bassDb,-24,6) || !v.outputs || typeof v.outputs !== 'object' || Array.isArray(v.outputs)) throw new Error('监听处理器设置无效');
  const outputs = {};
  const hardware = {...hardwareDefaults(),...v.hardware};
  if (typeof hardware.enabled !== 'boolean') throw new Error('硬件开关无效');
  const ranges = {inputDb:[-60,12],dacBits:[8,24],lineRms:[0.1,12],gainDb:[0,40],railV:[1,80],currentA:[0.01,30],loadOhms:[2,600],outputOhms:[0,20],bandwidthHz:[5000,250000]};
  if (Object.keys(hardware).some(k=>k!=='enabled'&&!ranges[k]) || !Number.isInteger(hardware.dacBits)
    || Object.entries(ranges).some(([k,[lo,hi]])=>!bounded(hardware[k],lo,hi))) throw new Error('硬件参数无效');
  for (const [name,o] of Object.entries(v.outputs)) {
    if (!names.includes(name) || !o || !bounded(o.trimDb,-24,6) || !bounded(o.delayMs,0,20)
      || typeof o.invert !== 'boolean' || typeof o.muted !== 'boolean') throw new Error('监听输出设置无效');
    outputs[name] = {trimDb:o.trimDb,delayMs:o.delayMs,invert:o.invert,muted:o.muted};
  }
  return {enabled:v.enabled,levelDb:v.levelDb,dim:v.dim,dimDb:v.dimDb,muted:v.muted,
    bassEnabled:v.bassEnabled,crossoverHz:v.crossoverHz,bassDb:v.bassDb,outputs,...(v.hardware ? {hardware} : {})};
}
module.exports = {defaults,validate};

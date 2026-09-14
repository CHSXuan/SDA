function roomSpeakers(layout) {
  const [floor,,top=0]=layout.split('.').map(Number);
  const list=[['FrontLeft',30,0],['FrontRight',-30,0]];
  if(floor>=5)list.push(['Center',0,0],['SurroundLeft',floor===5?110:100,0],['SurroundRight',floor===5?-110:-100,0]);
  if(floor>=7)list.push(['RearLeft',140,0],['RearRight',-140,0]);
  if(floor>=9)list.push(['WideLeft',60,0],['WideRight',-60,0]);
  if(top===2||top===6)list.push(['TopMiddleLeft',90,45],['TopMiddleRight',-90,45]);
  if(top>=4)list.push(['TopFrontLeft',45,45],['TopFrontRight',-45,45],['TopRearLeft',135,45],['TopRearRight',-135,45]);
  if(layout==='360RA-13')list.splice(0,list.length,['FrontLeft', 30, 0],['FrontRight', -30, 0],['Center', 0, 0],['SurroundLeft', 110, 0],['SurroundRight', -110, 0],['UpperFrontLeft', 30, 30],['UpperFrontRight', -30, 30],['UpperCenter', 0, 30],['UpperRearLeft', 110, 30],['UpperRearRight', -110, 30],['LowerFrontLeft', 30, -20],['LowerFrontRight', -30, -20],['LowerCenter', 0, -20]);
  if(layout==='22.2')list.splice(0,list.length,['I_M_L060', 60, 0],['I_M_R060', -60, 0],['I_M_000', 0, 0],['I_M_L135', 135, 0],['I_M_R135', -135, 0],['I_M_L030', 30, 0],['I_M_R030', -30, 0],['I_M_180', 180, 0],['I_M_L090', 90, 0],['I_M_R090', -90, 0],['I_U_L045', 45, 35],['I_U_R045', -45, 35],['I_U_000', 0, 35],['I_T_000', 0, 90],['I_U_L135', 135, 35],['I_U_R135', -135, 35],['I_U_L090', 90, 35],['I_U_R090', -90, 35],['I_U_180', 180, 35],['I_L_000', 0, -15],['I_L_L045', 45, -15],['I_L_R045', -45, -15]);
  if(layout==='11.1.8')list.push(["Surround1Left", 122, 0],["Surround1Right", -122, 0],["FrontHeightLeft", 30, 25],["FrontHeightRight", -30, 25],["RearHeightLeft", 150, 25],["RearHeightRight", -150, 25]);
  return list.map(([name,azimuth,elevation])=>({name,azimuth,elevation}));
}
module.exports={roomSpeakers};

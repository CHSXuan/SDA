// Resolve the room before touching the running output. Never enable a disabled room.
function roomForLayout(cinema, layout, read, builtins) {
  if (!cinema?.settings?.enabled || !cinema.profileId) return null;
  const current=read(cinema.profileId).profile;
  if(current.layout===layout)return null;
  const remembered=cinema.layoutProfiles?.[layout];
  if(remembered){try{if(read(remembered).profile.layout===layout)return remembered;}catch{}}
  return builtins.find(room=>room.layout===layout)?.id ?? null;
}
function rememberRoom(cinema, profileId, layout) {
  return {...cinema,profileId,layoutProfiles:{...cinema?.layoutProfiles,...(profileId?{[layout]:profileId}:{})}};
}
module.exports={roomForLayout,rememberRoom};

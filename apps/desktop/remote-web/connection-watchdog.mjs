// A delayed browser timer is not evidence that the server is dead. Give queued
// socket events time to run, then require a bounded fresh response before failing.
export class ConnectionWatchdog {
  constructor(){this.lastTick=0;this.probeAt=0;}
  check(now,lastMessage,hidden){
    const resumed=this.lastTick>0&&now-this.lastTick>5000;this.lastTick=now;
    if(now-lastMessage<=15000){this.probeAt=0;return "alive";}
    if(hidden){this.probeAt=0;return "background";}
    if(resumed||!this.probeAt){this.probeAt=now;return "probing";}
    return now-this.probeAt>=10000?"expired":"probing";
  }
}

import {Canvas,useThree,useFrame} from "@react-three/fiber";
import {useEffect,useRef,useMemo} from "react";
import {BoxGeometry,EdgesGeometry,type Mesh} from "three";
import {Line2} from 'three/addons/lines/webgpu/Line2.js';
import {LineGeometry} from 'three/addons/lines/LineGeometry.js';
import {spatialRenderer} from '../spatial-renderer';
import Performance3D from './Performance3D';
import {pathPosition} from "../room-path-animation";
import {Line,OrbitControls} from "@react-three/drei";
import type {RoomVisual} from "./RoomLab";

function RoomOutline({size}:{size:[number,number,number]}){
 const geometry=useMemo(()=>{const box=new BoxGeometry(...size);const edges=new EdgesGeometry(box);box.dispose();return edges;},[...size]);
 useEffect(()=>()=>geometry.dispose(),[geometry]);
 return <lineSegments geometry={geometry}><lineBasicMaterial color="#667e99"/></lineSegments>;
}
function NodeRay({points,color,width,opacity}:{points:[number,number,number][];color:string;width:number;opacity:number}){
 const line=useMemo(()=>{const line=new Line2(new LineGeometry().setPositions(points.flat()));line.material.color.set(color);line.material.linewidth=width;line.material.transparent=true;line.material.opacity=opacity;return line;},[points,color,width,opacity]);
 useEffect(()=>()=>{line.geometry.dispose();line.material.dispose();},[line]);
 return <primitive object={line}/>;
}
function Ray(props:{points:[number,number,number][];color:string;width:number;opacity:number}){
 const nodes=useThree(s=>(s.gl as unknown as {isWebGPURenderer?:boolean}).isWebGPURenderer);
 return nodes?<NodeRay {...props}/>:<Line points={props.points} color={props.color} lineWidth={props.width} transparent opacity={props.opacity}/>;
}

function Framing({radius}:{radius:number}){
  const {camera,size,invalidate}=useThree();
  useEffect(()=>{
    const angle=Math.atan(Math.tan(55*Math.PI/360)*Math.min(1,size.width/size.height));
    camera.position.normalize().multiplyScalar(radius/Math.sin(angle)*1.1);camera.lookAt(0,0,0);invalidate();
  },[camera,size.width,size.height,radius,invalidate]);
  return null;
}

function Propagation({visual,point}:{visual:RoomVisual;point:(p:[number,number,number])=>[number,number,number]}) {
  const markers=useRef<(Mesh|null)[]>([]),elapsed=useRef(0);
  const paths=visual.simulation.paths[visual.speaker]??[];
  const {playing=true,slowdown=100}=visual.animation??{};
  const maximum=Math.max(0,...paths.map(p=>p.distance));
  useEffect(()=>{elapsed.current=0;},[visual.simulation,visual.speaker]);
  useFrame((_,delta)=>{
    const duration=maximum/343+.65/slowdown;
    if(playing)elapsed.current=(elapsed.current+Math.min(delta,.1)/slowdown)%duration;
    paths.forEach((path,index)=>{
      for(let trail=0;trail<4;trail++) {
        const mesh=markers.current[index*4+trail];if(!mesh)continue;
        const position=pathPosition(path.points,elapsed.current*343-trail*.13);
        mesh.visible=position!==null;
        if(position)mesh.position.set(...point(position));
      }
    });
  });
  return <>{paths.flatMap((path,index)=>Array.from({length:4},(_,trail)=><mesh key={`${path.wall}-${trail}`} ref={mesh=>{markers.current[index*4+trail]=mesh;}} raycast={()=>{}}>
    <sphereGeometry args={[trail===0?.065:.04,12,8]}/>
    <meshBasicMaterial color={path.order===0?"#83ffd5":"#ffd091"} transparent opacity={1-trail*.22}/>
  </mesh>))}</>;
}

export default function RoomRayView({visual,onSelect}:{visual:RoomVisual;onSelect:(name:string)=>void}){
  const {simulation,speaker}=visual;
  const [length,width,height]=simulation.size;
  const createRenderer=useMemo(()=>spatialRenderer(window.sdaDesktop?.rendererMode==='swiftshader'),[]);
  const point=([x,y,z]:[number,number,number]):[number,number,number]=>[-(y-width/2),z-simulation.listener[2],-(x-length/2)];
  return <Canvas gl={createRenderer} frameloop={visual.animation?.playing===false?"demand":"always"} camera={{position:[width*.9,height,length*.95],fov:55}} style={{background:"#0c101c"}}>
    <Performance3D/>
    <Framing radius={Math.hypot(length,width,height)/2}/>
    <ambientLight intensity={1}/><directionalLight position={[3,5,2]} intensity={2}/>
    <group position={[0,height/2-simulation.listener[2],0]}><RoomOutline size={[width,height,length]}/></group>
    <gridHelper args={[Math.max(width,length),12,"#607085","#303d50"]} position={[0,-simulation.listener[2],0]}/>
    <mesh position={point(simulation.listener)}><sphereGeometry args={[.13,24,16]}/><meshStandardMaterial color="#a3b2c3"/></mesh>
    <mesh position={[0,0,-.14]} rotation={[Math.PI/2,0,0]}><coneGeometry args={[.045,.1,12]}/><meshStandardMaterial color="#a3b2c3"/></mesh>
    {Object.entries(simulation.positions).map(([name,pos])=><group key={name} position={point(pos)} onClick={e=>{e.stopPropagation();onSelect(name);}}>
      <mesh><boxGeometry args={[.19,.28,.18]}/><meshStandardMaterial color={name===speaker?"#e7be5b":"#72839a"}/></mesh>
      <mesh position={[0,0,.10]} rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[.055,.055,.02,20]}/><meshStandardMaterial color="#19212b"/></mesh>
    </group>)}
    {simulation.paths[speaker]?.map(p=><Ray key={p.wall} points={p.points.map(point)} color={p.order===0?"#64e1b4":"#e8af61"} width={p.order===0?3:1.4} opacity={p.order===0?1:.65}/>)}
    <Propagation visual={visual} point={point}/>
    <OrbitControls makeDefault enableDamping minDistance={1} maxDistance={80}/>
  </Canvas>;
}

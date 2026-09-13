import {useEffect,useRef} from "react";
import {X} from "lucide-react";
import {GlassRefraction} from "./GlassRefraction";
import "./SheetHeading.css";
export default function SheetHeading({title,detail,onClose}:{title:string;detail?:string;onClose?:()=>void}){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const heading=ref.current,panel=heading?.parentElement;if(!heading||!panel)return;
  let frame=0;const update=()=>{frame=0;heading.style.setProperty("--sheet-scroll",String(Math.min(1,Math.max(0,panel.scrollTop)/32)));};
  const scroll=()=>{if(!frame)frame=requestAnimationFrame(update);};
  panel.addEventListener("scroll",scroll,{passive:true});update();
  return()=>{panel.removeEventListener("scroll",scroll);cancelAnimationFrame(frame);};
 },[]);
 return <div className="desktop-sheet-heading" ref={ref}><div><h2>{title}</h2>{detail&&<small>{detail}</small>}</div>{onClose&&<button type="button" className="desktop-sheet-close" aria-label={`关闭${title}`} onClick={onClose}><GlassRefraction strength={10}/><X size={20}/></button>}</div>;
}

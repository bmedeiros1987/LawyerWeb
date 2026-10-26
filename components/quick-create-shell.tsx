"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/** Presentation only: closing hides the form without unmounting its draft. */
export function QuickCreateShell({title,summary,children}:{title:string;summary:ReactNode;children:ReactNode}) {
  const details = useRef<HTMLDetailsElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  function close(){if(details.current){details.current.open=false;details.current.querySelector("summary")?.focus();}}
  useEffect(()=>{
    const root=details.current, box=panel.current;
    if(!root||!box)return;
    const viewport=window.visualViewport;
    let frame:number|undefined;
    function schedule(){
      if(frame!==undefined)return;
      frame=requestAnimationFrame(()=>{frame=undefined;place();});
    }
    function setStyle(property:"position"|"width"|"left"|"right"|"bottom"|"maxHeight"|"top",value:string){
      if(box && box.style[property]!==value)box.style[property]=value;
    }
    function place(){
      if(!root?.open||!box)return;
      const v=window.visualViewport;
      const height=v?.height??window.innerHeight;
      const width=v?.width??window.innerWidth;
      const x=v?.offsetLeft??0, y=v?.offsetTop??0;
      const gap=12;
      const panelWidth=Math.max(1,Math.min(520,width-2*gap));
      const available=Math.max(1,height-2*gap);
      const anchor=root.querySelector("summary")!.getBoundingClientRect();
      const left=Math.max(x+gap,Math.min(anchor.left,x+width-gap-panelWidth));
      setStyle("position","fixed");setStyle("width",`${panelWidth}px`);
      setStyle("left",`${left}px`);setStyle("right","auto");setStyle("bottom","auto");
      setStyle("maxHeight",`${available}px`);
      // Prefer below the trigger, then shift the entire panel inside the visible viewport.
      const measured=box.getBoundingClientRect().height;
      setStyle("top",`${Math.max(y+gap,Math.min(anchor.bottom+8,y+height-gap-measured))}px`);
    }
    const escape=(event:KeyboardEvent)=>{if(event.key==="Escape"&&root?.open){event.preventDefault();close();}};
    // Observe both the visible panel and its natural content height: validation can
    // grow inside an already capped/scrolled panel. Top-only writes do not resize
    // either target; RAF coalescing and unchanged-style guards prevent feedback.
    const observer=new ResizeObserver(schedule);
    observer.observe(box);
    if(content.current)observer.observe(content.current);
    root.addEventListener("toggle",schedule);
    window.addEventListener("resize",schedule);window.addEventListener("scroll",schedule,true);
    viewport?.addEventListener("resize",schedule);viewport?.addEventListener("scroll",schedule);
    document.addEventListener("keydown",escape);
    // "Novo ▸ Cliente/Processo/…" links point at "#novo": open this form and focus its first field.
    const openFromHash=()=>{if(window.location.hash==="#novo"&&root&&!root.open){root.open=true;requestAnimationFrame(()=>content.current?.querySelector<HTMLElement>("input,select,textarea")?.focus());history.replaceState(null,"",window.location.pathname+window.location.search);}};
    openFromHash();window.addEventListener("hashchange",openFromHash);
    return()=>{window.removeEventListener("hashchange",openFromHash);observer.disconnect();if(frame!==undefined)cancelAnimationFrame(frame);root?.removeEventListener("toggle",schedule);window.removeEventListener("resize",schedule);window.removeEventListener("scroll",schedule,true);viewport?.removeEventListener("resize",schedule);viewport?.removeEventListener("scroll",schedule);document.removeEventListener("keydown",escape);};
  },[]);
  return <details ref={details} className="quick-create">
    <summary className="new-button">{summary}</summary>
    <div ref={panel} className="quick-create-popover viewport-popover">
      <div className="quick-create-head"><strong>{title}</strong><button type="button" className="icon-button" aria-label="Fechar formulário" onClick={close}><X size={15}/></button></div>
      <div ref={content}>{children}</div>
    </div>
  </details>;
}

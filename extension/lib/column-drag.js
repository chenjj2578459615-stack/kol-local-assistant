// Native dragover events become sparse when the pointer stops. Keep scrolling
// on animation frames so a held item can traverse the whole column list.
export function attachColumnAutoScroll(dialog,isDragging){
  const container=dialog.querySelector('.dialog-body');let point=null,frame=0,last=0;
  const stop=()=>{point=null;last=0;cancelAnimationFrame(frame);frame=0;};
  function tick(time){
    if(!dialog.open||!isDragging()||!point){stop();return;}
    const rect=container.getBoundingClientRect(),edge=Math.min(64,rect.height/4);
    const nearTop=Math.max(0,Math.min(1,(rect.top+edge-point.y)/edge));
    const nearBottom=Math.max(0,Math.min(1,(point.y-(rect.bottom-edge))/edge));
    const speed=(nearBottom-nearTop)*720,elapsed=last?Math.min(40,time-last):16;last=time;
    if(point.x>=rect.left&&point.x<=rect.right&&point.y>=rect.top-25&&point.y<=rect.bottom+25)container.scrollTop+=speed*elapsed/1000;
    frame=requestAnimationFrame(tick);
  }
  document.addEventListener('dragover',event=>{
    if(!dialog.open||!isDragging())return;
    point={x:event.clientX,y:event.clientY};
    const rect=container.getBoundingClientRect();if(point.x>=rect.left&&point.x<=rect.right)event.preventDefault();
    if(!frame)frame=requestAnimationFrame(tick);
  });
  for(const name of ['drop','dragend'])document.addEventListener(name,stop);
  dialog.addEventListener('close',stop);window.addEventListener('blur',stop);
  return stop;
}

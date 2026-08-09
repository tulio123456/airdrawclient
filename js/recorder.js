import { downloadBlob } from './storage.js';
import { drawActionOnContext } from './drawing.js';

function bestMime() {
  const types = ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm','video/mp4'];
  return types.find(t => window.MediaRecorder?.isTypeSupported?.(t)) || '';
}

function drawVideoCover(ctx, video, w, h, mirror) {
  const vw=video.videoWidth||w, vh=video.videoHeight||h;
  const scale=Math.max(w/vw,h/vh), sw=w/scale, sh=h/scale, sx=(vw-sw)/2, sy=(vh-sh)/2;
  ctx.save();
  if (mirror) { ctx.translate(w,0); ctx.scale(-1,1); }
  ctx.drawImage(video,sx,sy,sw,sh,0,0,w,h);
  ctx.restore();
}

export class AirDrawRecorder {
  constructor(video, drawCanvas) {
    this.video=video; this.drawCanvas=drawCanvas;
    this.canvas=document.createElement('canvas'); this.ctx=this.canvas.getContext('2d');
    this.recorder=null; this.chunks=[]; this.raf=0; this.startedAt=0; this.timer=0;
  }

  supported() { return !!(window.MediaRecorder && this.canvas.captureStream); }

  start({ mirror=true, includeCamera=true, onTick=()=>{} }={}) {
    if (!this.supported() || this.recorder?.state==='recording') return false;
    const w=Math.min(1280, Math.max(640, innerWidth));
    const h=Math.round(w * innerHeight / innerWidth);
    this.canvas.width=w; this.canvas.height=h;
    const render=()=>{
      if (!this.recorder || this.recorder.state==='inactive') return;
      this.ctx.clearRect(0,0,w,h);
      if(includeCamera) drawVideoCover(this.ctx,this.video,w,h,mirror);
      else {this.ctx.fillStyle='#05070b';this.ctx.fillRect(0,0,w,h);}
      this.ctx.drawImage(this.drawCanvas,0,0,w,h);
      this.raf=requestAnimationFrame(render);
    };
    const stream=this.canvas.captureStream(30);
    const mimeType=bestMime();
    this.chunks=[];
    this.recorder=new MediaRecorder(stream,mimeType?{mimeType}:undefined);
    this.recorder.ondataavailable=e=>{if(e.data?.size)this.chunks.push(e.data)};
    this.recorder.onstop=()=>{
      cancelAnimationFrame(this.raf); clearInterval(this.timer);
      const blob=new Blob(this.chunks,{type:this.recorder.mimeType||'video/webm'});
      downloadBlob(blob,`airdraw-gravacao-${Date.now()}.${blob.type.includes('mp4')?'mp4':'webm'}`);
    };
    this.recorder.start(250); this.startedAt=performance.now(); render();
    this.timer=setInterval(()=>onTick((performance.now()-this.startedAt)/1000),250);
    onTick(0); return true;
  }

  stop() {
    if(this.recorder?.state==='recording'){this.recorder.stop();return true}
    return false;
  }

  async timelapse(actions, sourceWidth=innerWidth, sourceHeight=innerHeight) {
    if (!this.supported() || !actions.length) return false;
    const w=Math.min(960,Math.max(540,sourceWidth)), h=Math.round(w*sourceHeight/sourceWidth);
    const canvas=document.createElement('canvas'); canvas.width=w; canvas.height=h;
    const ctx=canvas.getContext('2d'); ctx.fillStyle='#05070b'; ctx.fillRect(0,0,w,h);
    const stream=canvas.captureStream(30), mimeType=bestMime(), chunks=[];
    const rec=new MediaRecorder(stream,mimeType?{mimeType}:undefined);
    rec.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data)};
    const stopped=new Promise(resolve=>{rec.onstop=()=>resolve(new Blob(chunks,{type:rec.mimeType||'video/webm'}))});
    rec.start(100);
    const sx=w/sourceWidth, sy=h/sourceHeight;
    for (const action of actions) {
      if(action.type==='stroke' && action.points?.length>2) {
        const pts=action.points;
        const batch=Math.max(2,Math.ceil(pts.length/10));
        for(let i=batch;i<=pts.length;i+=batch){
          const partial={...action,points:pts.slice(Math.max(0,i-batch-1),Math.min(i,pts.length))};
          drawActionOnContext(ctx,partial,sx,sy);
          await new Promise(r=>setTimeout(r,26));
        }
      } else {
        drawActionOnContext(ctx,action,sx,sy);
        await new Promise(r=>setTimeout(r,80));
      }
    }
    await new Promise(r=>setTimeout(r,350)); rec.stop();
    const blob=await stopped;
    downloadBlob(blob,`airdraw-timelapse-${Date.now()}.${blob.type.includes('mp4')?'mp4':'webm'}`);
    return true;
  }
}

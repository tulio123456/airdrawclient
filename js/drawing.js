function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function downloadDataURL(dataURL, filename) {
  const a = document.createElement('a');
  a.href = dataURL;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export class DrawingEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.color = '#ffffff';
    this.width = 8;
    this.opacity = 1;
    this.brushType = 'solid';
    this.erasing = false;
    this.history = [];
    this.redoStack = [];
    this.maxHistory = 24;
    this.stroke = null;
    this.actions = [];
    this.viewport = { zoom: 1, x: 0, y: 0 };
  }

  resize(w, h, dpr) {
    const backup = document.createElement('canvas');
    backup.width = this.canvas.width;
    backup.height = this.canvas.height;
    if (backup.width && backup.height) backup.getContext('2d').drawImage(this.canvas, 0, 0);
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (backup.width && backup.height) {
      this.ctx.drawImage(backup, 0, 0, backup.width, backup.height, 0, 0, w, h);
    }
  }

  setStyle({ color, width, opacity, brushType, erasing } = {}) {
    if (color) this.color = color;
    if (width != null) this.width = Number(width);
    if (opacity != null) this.opacity = clamp(Number(opacity), 0, 1);
    if (brushType) this.brushType = brushType;
    if (erasing != null) this.erasing = !!erasing;
  }

  setViewport(viewport) {
    this.viewport = { ...this.viewport, ...viewport };
    const { zoom, x, y } = this.viewport;
    this.canvas.style.transformOrigin = '50% 50%';
    this.canvas.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
  }

  screenToWorld(p) {
    const { zoom, x, y } = this.viewport;
    const cx = innerWidth / 2;
    const cy = innerHeight / 2;
    return {
      x: cx + (p.x - cx - x) / zoom,
      y: cy + (p.y - cy - y) / zoom
    };
  }

  snapshot() {
    try {
      this.history.push(this.canvas.toDataURL('image/png'));
      if (this.history.length > this.maxHistory) this.history.shift();
      this.redoStack.length = 0;
    } catch {}
  }

  currentDataURL() { return this.canvas.toDataURL('image/png'); }

  async loadDataURL(src) {
    if (!src) {
      this.ctx.clearRect(0, 0, innerWidth, innerHeight);
      return;
    }
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = src;
    });
    this.ctx.clearRect(0, 0, innerWidth, innerHeight);
    this.ctx.drawImage(img, 0, 0, innerWidth, innerHeight);
  }

  async undo() {
    const src = this.history.pop();
    if (!src) return false;
    this.redoStack.push(this.currentDataURL());
    await this.loadDataURL(src);
    return true;
  }

  async redo() {
    const src = this.redoStack.pop();
    if (!src) return false;
    this.history.push(this.currentDataURL());
    await this.loadDataURL(src);
    return true;
  }

  clear() {
    this.snapshot();
    this.ctx.clearRect(0, 0, innerWidth, innerHeight);
    this.actions.push({ type: 'clear' });
  }

  beginStroke(point, temporaryEraser = false) {
    this.snapshot();
    this.stroke = {
      points: [point],
      style: this.styleSnapshot(temporaryEraser),
      baseImage: this.history[this.history.length - 1] || null
    };
  }

  styleSnapshot(temporaryEraser = false) {
    return {
      color: this.color,
      width: this.width,
      opacity: this.opacity,
      brushType: this.brushType,
      erasing: this.erasing || temporaryEraser
    };
  }

  addStrokePoint(point, temporaryEraser = false) {
    if (!this.stroke) this.beginStroke(point, temporaryEraser);
    const last = this.stroke.points[this.stroke.points.length - 1];
    this.stroke.points.push(point);
    this.drawSegment(last, point, this.stroke.style);
  }

  drawSegment(a, b, style) {
    const ctx = this.ctx;
    const w = Math.max(1, style.width);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = style.opacity;

    if (style.erasing) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = w * 2.3;
      ctx.strokeStyle = '#000';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.restore();
      return;
    }

    ctx.globalCompositeOperation = 'source-over';
    const type = style.brushType;
    if (type === 'spray') {
      const dots = Math.max(6, Math.round(w * 1.4));
      ctx.fillStyle = style.color;
      for (let i = 0; i < dots; i++) {
        const t = Math.random();
        const x = a.x + (b.x - a.x) * t + (Math.random() - .5) * w * 2.6;
        const y = a.y + (b.y - a.y) * t + (Math.random() - .5) * w * 2.6;
        ctx.beginPath(); ctx.arc(x, y, Math.max(.5, w * .10), 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      return;
    }
    if (type === 'dotted') {
      ctx.fillStyle = style.color;
      const spacing = Math.max(5, w * 1.8);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const count = Math.max(1, Math.floor(len / spacing));
      for (let i = 0; i <= count; i++) {
        const t = count ? i / count : 0;
        ctx.beginPath(); ctx.arc(a.x + (b.x-a.x)*t, a.y + (b.y-a.y)*t, w/2, 0, Math.PI*2); ctx.fill();
      }
      ctx.restore();
      return;
    }

    ctx.lineWidth = type === 'marker' ? w * 1.35 : w;
    ctx.strokeStyle = type === 'rainbow' ? `hsl(${(performance.now()/12)%360} 100% 62%)` : style.color;
    if (type === 'marker') ctx.globalAlpha *= .38;
    if (type === 'dashed') ctx.setLineDash([w * 2, w * 1.4]);
    if (type === 'neon' || type === 'glow' || type === 'laser') {
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = type === 'laser' ? w * 2.4 : type === 'neon' ? w * 2 : w * 1.25;
      if (type === 'laser') ctx.lineWidth = Math.max(2, w * .55);
    }
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.restore();
  }

  endStroke() {
    if (!this.stroke) return null;
    const finished = this.stroke;
    this.stroke = null;
    if (finished.points.length > 1) {
      this.actions.push({ type: 'stroke', points: finished.points, style: finished.style });
    }
    return this.circleCandidate(finished);
  }

  circleCandidate(stroke) {
    const pts = stroke?.points || [];
    if (pts.length < 18 || stroke.style.erasing) return null;
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = maxX-minX, h=maxY-minY;
    if (w < 45 || h < 45) return null;
    const ratio = Math.min(w,h)/Math.max(w,h);
    const close = Math.hypot(pts[0].x-pts.at(-1).x, pts[0].y-pts.at(-1).y) / Math.max(w,h);
    if (ratio < .72 || close > .38) return null;
    const cx=(minX+maxX)/2, cy=(minY+maxY)/2, r=(w+h)/4;
    const err = pts.reduce((s,p)=>s+Math.abs(Math.hypot(p.x-cx,p.y-cy)-r),0)/pts.length/r;
    if (err > .24) return null;
    return { cx, cy, r, baseImage: stroke.baseImage, style: stroke.style };
  }

  async replaceWithCircle(candidate) {
    if (!candidate) return;
    await this.loadDataURL(candidate.baseImage);
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = candidate.style.opacity;
    ctx.strokeStyle = candidate.style.color;
    ctx.lineWidth = candidate.style.width;
    ctx.lineCap = 'round';
    ctx.shadowColor = candidate.style.color;
    ctx.shadowBlur = candidate.style.brushType === 'glow' ? candidate.style.width * 1.4 : 0;
    ctx.beginPath(); ctx.arc(candidate.cx, candidate.cy, candidate.r, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
    this.actions[this.actions.length - 1] = {
      type: 'shape', shape: 'circle', start: {x:candidate.cx-candidate.r,y:candidate.cy-candidate.r},
      end: {x:candidate.cx+candidate.r,y:candidate.cy+candidate.r}, style:candidate.style
    };
  }

  drawShape(shape, start, end, style = this.styleSnapshot(false), snapshot = true) {
    if (snapshot) this.snapshot();
    const ctx = this.ctx;
    const x1=start.x,y1=start.y,x2=end.x,y2=end.y,w=x2-x1,h=y2-y1;
    ctx.save();
    ctx.globalAlpha=style.opacity; ctx.strokeStyle=style.color; ctx.fillStyle=style.color;
    ctx.lineWidth=style.width; ctx.lineCap='round'; ctx.lineJoin='round';
    if (style.brushType==='glow' || style.brushType==='neon') { ctx.shadowColor=style.color; ctx.shadowBlur=style.width*1.4; }
    ctx.beginPath();
    if (shape==='line') { ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); }
    else if (shape==='circle') { const cx=(x1+x2)/2,cy=(y1+y2)/2,r=Math.hypot(w,h)/2; ctx.arc(cx,cy,r,0,Math.PI*2); }
    else if (shape==='square') { const s=Math.max(Math.abs(w),Math.abs(h)); ctx.rect(x1,y1,Math.sign(w||1)*s,Math.sign(h||1)*s); }
    else if (shape==='rectangle') ctx.rect(x1,y1,w,h);
    else if (shape==='triangle') { ctx.moveTo((x1+x2)/2,y1); ctx.lineTo(x2,y2); ctx.lineTo(x1,y2); ctx.closePath(); }
    else if (shape==='arrow') {
      const ang=Math.atan2(h,w), head=Math.max(14,style.width*3);
      ctx.moveTo(x1,y1); ctx.lineTo(x2,y2);
      ctx.moveTo(x2,y2); ctx.lineTo(x2-head*Math.cos(ang-Math.PI/6),y2-head*Math.sin(ang-Math.PI/6));
      ctx.moveTo(x2,y2); ctx.lineTo(x2-head*Math.cos(ang+Math.PI/6),y2-head*Math.sin(ang+Math.PI/6));
    }
    ctx.stroke(); ctx.restore();
    this.actions.push({type:'shape',shape,start,end,style});
  }

  serialize(settings) {
    return { version: 3, createdAt: new Date().toISOString(), drawing: this.currentDataURL(), settings, viewport: this.viewport, actions: this.actions };
  }

  async loadProject(project) {
    await this.loadDataURL(project?.drawing);
    this.actions = Array.isArray(project?.actions) ? project.actions : [];
    if (project?.viewport) this.setViewport(project.viewport);
  }

  savePNG() { downloadDataURL(this.currentDataURL(), `airdraw-${Date.now()}.png`); }
}

export function drawActionOnContext(ctx, action, sx=1, sy=1) {
  if (!action) return;
  if (action.type === 'clear') { ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height); return; }
  if (action.type === 'stroke') {
    const style = action.style || {};
    ctx.save(); ctx.globalAlpha=style.opacity ?? 1; ctx.lineCap='round'; ctx.lineJoin='round';
    ctx.strokeStyle=style.color || '#fff'; ctx.lineWidth=(style.width||8)*((sx+sy)/2);
    if (style.erasing) ctx.globalCompositeOperation='destination-out';
    if (style.brushType==='dashed') ctx.setLineDash([ctx.lineWidth*2,ctx.lineWidth*1.4]);
    if (style.brushType==='glow'||style.brushType==='neon') {ctx.shadowColor=ctx.strokeStyle;ctx.shadowBlur=ctx.lineWidth*1.5;}
    const pts=action.points||[]; if (pts.length>1) {ctx.beginPath();ctx.moveTo(pts[0].x*sx,pts[0].y*sy);for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i].x*sx,pts[i].y*sy);ctx.stroke();}
    ctx.restore(); return;
  }
  if (action.type==='shape') {
    const s={...action.style,width:(action.style?.width||8)*((sx+sy)/2)};
    const a={x:action.start.x*sx,y:action.start.y*sy}, b={x:action.end.x*sx,y:action.end.y*sy};
    ctx.save();ctx.globalAlpha=s.opacity??1;ctx.strokeStyle=s.color||'#fff';ctx.lineWidth=s.width;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();
    const w=b.x-a.x,h=b.y-a.y;
    if(action.shape==='line'){ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y)}
    else if(action.shape==='circle'){ctx.arc((a.x+b.x)/2,(a.y+b.y)/2,Math.hypot(w,h)/2,0,Math.PI*2)}
    else if(action.shape==='square'){const q=Math.max(Math.abs(w),Math.abs(h));ctx.rect(a.x,a.y,Math.sign(w||1)*q,Math.sign(h||1)*q)}
    else if(action.shape==='rectangle')ctx.rect(a.x,a.y,w,h);
    else if(action.shape==='triangle'){ctx.moveTo((a.x+b.x)/2,a.y);ctx.lineTo(b.x,b.y);ctx.lineTo(a.x,b.y);ctx.closePath()}
    else if(action.shape==='arrow'){const ang=Math.atan2(h,w),head=Math.max(14,s.width*3);ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-head*Math.cos(ang-Math.PI/6),b.y-head*Math.sin(ang-Math.PI/6));ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-head*Math.cos(ang+Math.PI/6),b.y-head*Math.sin(ang+Math.PI/6));}
    ctx.stroke();ctx.restore();
  }
}

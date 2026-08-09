import { FilesetResolver, HandLandmarker, FaceDetector } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/+esm';
import { DrawingEngine } from './js/drawing.js';
import { analyzeHand, GestureGate, smoothPoint, distance } from './js/gestures.js';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, resetSettings, downloadJSON } from './js/storage.js';
import { AirDrawRecorder } from './js/recorder.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const video=$('#video'), drawCanvas=$('#drawCanvas'), hudCanvas=$('#hudCanvas');
if(!video||!drawCanvas||!hudCanvas) throw new Error('AirDraw: canvases ou vídeo ausentes.');
const hud=hudCanvas.getContext('2d');
const engine=new DrawingEngine(drawCanvas);
const recorder=new AirDrawRecorder(video,drawCanvas);
let settings=loadSettings();
let stream=null, handLandmarker=null, faceDetector=null, running=false, detectionBusy=false;
let lastVideoTime=-1,lastTimestamp=-1,faceLastRun=0,rafId=0;
let smoothDrawingPoint=null,smoothControlPoint=null,drawing=false,shapeStart=null,shapeMode=false;
let temporaryErase=false, radialOpenAt=0, radialSelection=null, radialVisible=false;
let viewport={zoom:1,x:0,y:0}, twoHandPrev=null, navPrev=null;
let fpsFrames=0,fpsLast=performance.now(),fps=0,lastConfidence=0,lastLatency=0;
let lastHands=[], lastAnalyses=[], smartCandidate=null;
let gallery=[];
let calibration=null;
const gate=new GestureGate();
const palette=['#ffffff','#63a7ff','#ff6178','#70e8a0','#ffd469','#b58aff'];
const brushTypes=['solid','marker','neon','glow','spray','dotted','dashed','laser','rainbow'];
const handConnections=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];

const els={
  app:$('#app'), ai:$('#aiStatus'), hand:$('#handStatus'), face:$('#faceStatus'), photo:$('#photoStatus'), cursor:$('#cursor'), toast:$('#toast'), faceGuide:$('#faceGuide'), handLabel:$('#handLabel'),
  startScreen:$('#startScreen'),consent:$('#consent'),start:$('#start'),brush:$('#brush'),brushText:$('#brushText'),opacity:$('#opacity'),opacityText:$('#opacityText'),customColor:$('#customColor'),brushType:$('#brushType'),
  pen:$('#pen'),eraser:$('#eraser'),undo:$('#undo'),redo:$('#redo'),clear:$('#clear'),save:$('#save'),shapeMode:$('#shapeMode'),shapeType:$('#shapeType'),navigationMode:$('#navigationMode'),resetView:$('#resetView'),
  panel:$('#controlPanel'),panelToggle:$('#panelToggle'),panelClose:$('#panelClose'),cameraQuick:$('#cameraQuick'),cameraSelect:$('#cameraSelect'),cameraQuality:$('#cameraQuality'),mirror:$('#mirrorCamera'),showCamera:$('#showCamera'),background:$('#backgroundMode'),
  saveProject:$('#saveProject'),loadProject:$('#loadProject'),projectFile:$('#projectFile'),record:$('#record'),stopRecord:$('#stopRecord'),timelapse:$('#timelapse'),galleryBtn:$('#galleryBtn'),capturePhoto:$('#capturePhoto'),recStatus:$('#recStatus'),
  smoothing:$('#smoothing'),sensitivity:$('#sensitivity'),sensitivityText:$('#sensitivityText'),minConfidence:$('#minConfidence'),confidenceText:$('#confidenceText'),maxHands:$('#maxHands'),drawingHand:$('#drawingHand'),showSkeleton:$('#showSkeleton'),showCursor:$('#showCursor'),showPerformance:$('#showPerformance'),gesturesEnabled:$('#gesturesEnabled'),faceGuideToggle:$('#faceGuideToggle'),calibrate:$('#calibrate'),resetSettings:$('#resetSettings'),
  performance:$('#performance'),fpsValue:$('#fpsValue'),confidenceValue:$('#confidenceValue'),handsValue:$('#handsValue'),latencyValue:$('#latencyValue'),radial:$('#radialMenu'),smartPrompt:$('#smartPrompt'),smartYes:$('#smartYes'),smartNo:$('#smartNo'),saveDialog:$('#saveDialog'),saveDrawingOnly:$('#saveDrawingOnly'),saveWithCamera:$('#saveWithCamera'),galleryDialog:$('#galleryDialog'),galleryGrid:$('#galleryGrid'),calibrationDialog:$('#calibrationDialog'),calibrationTitle:$('#calibrationTitle'),calibrationText:$('#calibrationText'),calibrationProgress:$('#calibrationProgress')
};

function setStatus(el,text,state=''){if(!el)return;el.classList.remove('ok','warn');if(state)el.classList.add(state);const s=el.querySelector('span');if(s)s.textContent=text;}
function say(text){els.toast.textContent=text;els.toast.classList.add('show');clearTimeout(say.t);say.t=setTimeout(()=>els.toast.classList.remove('show'),1800)}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function fmtTime(sec){const s=Math.floor(sec);return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`}
function persist(){saveSettings(settings)}
function applyEngine(){engine.setStyle({color:settings.color,width:settings.width,opacity:settings.opacity,brushType:settings.brushType,erasing:engine.erasing});}

function applySettingsToUI(){
  els.brush.value=settings.width;els.brushText.textContent=`${settings.width} px`;els.opacity.value=Math.round(settings.opacity*100);els.opacityText.textContent=`${Math.round(settings.opacity*100)}%`;
  els.customColor.value=settings.color;els.brushType.value=settings.brushType;els.smoothing.value=settings.smoothing;els.sensitivity.value=Math.round(settings.sensitivity*100);els.sensitivityText.textContent=`${Math.round(settings.sensitivity*100)}%`;
  els.minConfidence.value=Math.round(settings.minConfidence*100);els.confidenceText.textContent=settings.minConfidence.toFixed(2);els.maxHands.value=String(settings.maxHands);els.drawingHand.value=settings.drawingHand;
  els.mirror.checked=settings.mirror;els.showCamera.checked=settings.showVideo;els.background.value=settings.background;els.cameraQuality.value=settings.cameraQuality;els.showSkeleton.checked=settings.showSkeleton;els.showCursor.checked=settings.showCursor;els.showPerformance.checked=settings.showPerformance;els.gesturesEnabled.checked=settings.gesturesEnabled;els.faceGuideToggle.checked=settings.faceGuide;els.navigationMode.checked=settings.navigationMode;
  $$('.color').forEach(b=>b.classList.toggle('active',b.dataset.color.toLowerCase()===settings.color.toLowerCase()));
  els.performance.hidden=!settings.showPerformance; els.faceGuide.classList.toggle('disabled',!settings.faceGuide); updateVisualCamera(); applyEngine();
}

function updateVisualCamera(){
  video.style.transform=settings.mirror?'scaleX(-1)':'none';
  video.classList.toggle('videoHidden',!settings.showVideo || ['black','white','transparent'].includes(settings.background));
  els.app.dataset.background=settings.background;
}

function resize(){
  const dpr=Math.min(devicePixelRatio||1,2);engine.resize(innerWidth,innerHeight,dpr);hudCanvas.width=Math.round(innerWidth*dpr);hudCanvas.height=Math.round(innerHeight*dpr);hudCanvas.style.width=`${innerWidth}px`;hudCanvas.style.height=`${innerHeight}px`;hud.setTransform(dpr,0,0,dpr,0,0);engine.setViewport(viewport);
}

function screenPoint(lm){return{x:(settings.mirror?1-lm.x:lm.x)*innerWidth,y:lm.y*innerHeight}}
function handedness(result,i){return result?.handednesses?.[i]?.[0]?.categoryName || result?.handedness?.[i]?.[0]?.categoryName || `Mão ${i+1}`}
function handConfidence(result,i){return Number(result?.handednesses?.[i]?.[0]?.score ?? result?.handedness?.[i]?.[0]?.score ?? 0)}

function drawHUD(hands, analyses, result){
  hud.clearRect(0,0,innerWidth,innerHeight);
  if(settings.showSkeleton){
    hands.forEach((hand,i)=>{
      hud.save();hud.strokeStyle='rgba(147,161,255,.6)';hud.fillStyle='rgba(255,255,255,.82)';hud.lineWidth=1.4;
      handConnections.forEach(([a,b])=>{const p=screenPoint(hand[a]),q=screenPoint(hand[b]);hud.beginPath();hud.moveTo(p.x,p.y);hud.lineTo(q.x,q.y);hud.stroke()});
      hand.forEach((lm,j)=>{const p=screenPoint(lm);hud.beginPath();hud.arc(p.x,p.y,j===8?4:2.2,0,Math.PI*2);hud.fill()});hud.restore();
    });
  }
  if(shapeMode&&shapeStart&&smoothDrawingPoint){
    const a=engine.screenToWorld(shapeStart),b=engine.screenToWorld(smoothDrawingPoint);hud.save();hud.strokeStyle=settings.color;hud.globalAlpha=.7;hud.lineWidth=Math.max(2,settings.width);hud.setLineDash([7,6]);previewShape(hud,els.shapeType.value,a,b);hud.restore();
  }
}
function previewShape(ctx,shape,a,b){const w=b.x-a.x,h=b.y-a.y;ctx.beginPath();if(shape==='line'){ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y)}else if(shape==='circle'){ctx.arc((a.x+b.x)/2,(a.y+b.y)/2,Math.hypot(w,h)/2,0,Math.PI*2)}else if(shape==='square'){const s=Math.max(Math.abs(w),Math.abs(h));ctx.rect(a.x,a.y,Math.sign(w||1)*s,Math.sign(h||1)*s)}else if(shape==='rectangle')ctx.rect(a.x,a.y,w,h);else if(shape==='triangle'){ctx.moveTo((a.x+b.x)/2,a.y);ctx.lineTo(b.x,b.y);ctx.lineTo(a.x,b.y);ctx.closePath()}else{ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y)}ctx.stroke()}

function cursorAt(p,pinching=false){if(!settings.showCursor){els.cursor.style.opacity='0';return}els.cursor.style.opacity='1';els.cursor.style.left=`${p.x}px`;els.cursor.style.top=`${p.y}px`;els.cursor.classList.toggle('draw',pinching);}
function hideCursor(){els.cursor.style.opacity='0';els.cursor.classList.remove('draw')}

async function loadAI(){
  if(handLandmarker)return;
  setStatus(els.ai,'Carregando MediaPipe...','warn');
  const vision=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm');
  const handModel='https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
  const opts={runningMode:'VIDEO',numHands:settings.maxHands,minHandDetectionConfidence:settings.minConfidence,minHandPresenceConfidence:settings.minConfidence,minTrackingConfidence:Math.max(.35,settings.minConfidence-.05)};
  try{handLandmarker=await HandLandmarker.createFromOptions(vision,{...opts,baseOptions:{modelAssetPath:handModel,delegate:'GPU'}})}catch(e){console.warn('[AirDraw] GPU indisponível, CPU:',e);handLandmarker=await HandLandmarker.createFromOptions(vision,{...opts,baseOptions:{modelAssetPath:handModel}})}
  try{faceDetector=await FaceDetector.createFromOptions(vision,{runningMode:'VIDEO',minDetectionConfidence:.5,baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'}})}catch(e){console.warn('[AirDraw] Guia de rosto indisponível:',e);faceDetector=null;setStatus(els.face,'Guia de rosto opcional','warn')}
  setStatus(els.ai,'MediaPipe pronto','ok');
}

function qualityConstraints(){const q=settings.cameraQuality;if(q==='sd')return{width:{ideal:640},height:{ideal:480}};if(q==='fullhd')return{width:{ideal:1920},height:{ideal:1080}};return{width:{ideal:1280},height:{ideal:720}}}
async function openCamera(deviceId=settings.cameraId){
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('Seu navegador não permite acesso à câmera.');
  setStatus(els.ai,'Abrindo câmera...','warn');
  const videoConstraints={...qualityConstraints()};
  if(deviceId) videoConstraints.deviceId={exact:deviceId}; else videoConstraints.facingMode='user';
  const newStream=await navigator.mediaDevices.getUserMedia({audio:false,video:videoConstraints});
  const old=stream;stream=newStream;video.srcObject=stream;await new Promise(r=>video.readyState>=1?r():video.addEventListener('loadedmetadata',r,{once:true}));await video.play();if(old)old.getTracks().forEach(t=>t.stop());
  const track=stream.getVideoTracks()[0];settings.cameraId=track?.getSettings?.().deviceId||deviceId||settings.cameraId;persist();await listCameras();
}
async function listCameras(){try{const devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');els.cameraSelect.innerHTML='';devices.forEach((d,i)=>{const o=document.createElement('option');o.value=d.deviceId;o.textContent=d.label||`Câmera ${i+1}`;els.cameraSelect.appendChild(o)});if(settings.cameraId)els.cameraSelect.value=settings.cameraId;}catch(e){console.warn(e)}}

function processFace(timestamp){if(!settings.faceGuide||!faceDetector||timestamp-faceLastRun<850)return;faceLastRun=timestamp;try{const r=faceDetector.detectForVideo(video,timestamp);const ok=!!r?.detections?.length;setStatus(els.face,ok?'Rosto enquadrado':'Enquadre o rosto',ok?'ok':'warn');els.faceGuide.classList.toggle('visible',!ok&&settings.faceGuide)}catch{}}

function radialPosition(center){els.radial.style.left=`${center.x}px`;els.radial.style.top=`${center.y}px`;}
function showRadial(center){if(!radialVisible){radialVisible=true;els.radial.classList.add('show');els.radial.setAttribute('aria-hidden','false');say('Menu por gestos')}radialPosition(center)}
function hideRadial(){radialVisible=false;radialSelection=null;radialOpenAt=0;els.radial.classList.remove('show');els.radial.setAttribute('aria-hidden','true');$$('[data-radial]').forEach(b=>b.classList.remove('active'))}
function updateRadialSelection(indexPoint,center){
  const dx=indexPoint.x-center.x,dy=indexPoint.y-center.y;if(Math.hypot(dx,dy)<35)return;
  const items=['color','brush','eraser','undo','shapes','clear'];let angle=Math.atan2(dy,dx)+Math.PI/2;if(angle<0)angle+=Math.PI*2;const idx=Math.round(angle/(Math.PI*2/items.length))%items.length;radialSelection=items[idx];$$('[data-radial]').forEach(b=>b.classList.toggle('active',b.dataset.radial===radialSelection));
}
async function activateRadial(action){
  if(action==='color'){const i=(palette.indexOf(settings.color)+1)%palette.length;setColor(palette[i]);say('Cor alterada')}
  else if(action==='brush'){const i=(brushTypes.indexOf(settings.brushType)+1)%brushTypes.length;settings.brushType=brushTypes[i];els.brushType.value=settings.brushType;applyEngine();persist();say(`Pincel: ${els.brushType.selectedOptions[0].textContent}`)}
  else if(action==='eraser'){setTool(engine.erasing?'pen':'eraser')}
  else if(action==='undo'){if(!await engine.undo())say('Nada para desfazer')}
  else if(action==='shapes'){shapeMode=!shapeMode;els.shapeMode.classList.toggle('active',shapeMode);say(shapeMode?'Modo formas':'Modo desenho')}
  else if(action==='clear'){engine.clear();say('Desenho limpo')}
  hideRadial();
}

function processTwoHands(hands){
  if(hands.length<2){twoHandPrev=null;return}
  const a=screenPoint(hands[0][9]),b=screenPoint(hands[1][9]),d=Math.hypot(a.x-b.x,a.y-b.y),center={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
  if(twoHandPrev){const ratio=d/twoHandPrev.d;if(Math.abs(ratio-1)>.015){viewport.zoom=clamp(viewport.zoom*ratio,.55,3);engine.setViewport(viewport)}}
  twoHandPrev={d,center};
}

function updateCalibration(analyses,hands){
  if(!calibration||!analyses[0])return;const a=analyses[0],p=screenPoint(hands[0][8]);const steps=[['Abra a mão','Mantenha a mão aberta e visível.',()=>a.open],['Faça pinça','Encoste polegar + indicador.',()=>a.pinching],['Mova o indicador','Mova o indicador para os lados.',()=>true],['Feche a mão','Faça um punho fechado.',()=>a.fist]];
  const [title,text,condition]=steps[calibration.step];els.calibrationTitle.textContent=`${calibration.step+1}. ${title}`;els.calibrationText.textContent=text;
  if(calibration.step===2){if(calibration.lastPoint)calibration.move+=Math.hypot(p.x-calibration.lastPoint.x,p.y-calibration.lastPoint.y);calibration.lastPoint=p;if(calibration.move>360)calibration.count=30;}else if(condition()){calibration.count++;if(calibration.step===1)calibration.pinch.push(a.pinchRatio)}else calibration.count=Math.max(0,calibration.count-1);
  els.calibrationProgress.style.width=`${clamp(calibration.count/30*100,0,100)}%`;
  if(calibration.count>=30){calibration.step++;calibration.count=0;calibration.lastPoint=null;if(calibration.step>=4){const avg=calibration.pinch.length?calibration.pinch.reduce((s,v)=>s+v,0)/calibration.pinch.length:.32;settings.pinchThreshold=clamp(avg*1.35,.28,.52);settings.smoothing='medium';settings.sensitivity=1;settings.minConfidence=clamp(settings.minConfidence,.45,.60);persist();applySettingsToUI();const update=handLandmarker?.setOptions?.({minHandDetectionConfidence:settings.minConfidence,minHandPresenceConfidence:settings.minConfidence,minTrackingConfidence:Math.max(.35,settings.minConfidence-.05)});update?.catch?.(()=>{});els.calibrationDialog.hidden=true;calibration=null;say('Calibração concluída')}}
}

function processHands(result,timestamp){
  const hands=result?.landmarks||[];lastHands=hands;const analyses=hands.map(h=>analyzeHand(h,clamp(settings.pinchThreshold*settings.sensitivity,.22,.62)));lastAnalyses=analyses;
  lastConfidence=hands.length?Math.max(...hands.map((_,i)=>handConfidence(result,i))):0;
  if(!hands.length){setStatus(els.hand,'Procurando mão...');hideCursor();els.handLabel.classList.remove('show');drawing=false;shapeStart=null;engine.endStroke();smoothDrawingPoint=null;smoothControlPoint=null;drawHUD([],[],result);updatePerformance(0);return}
  const labels=hands.map((_,i)=>handedness(result,i));setStatus(els.hand,hands.length===1?`${labels[0]} detectada`:`${hands.length} mãos detectadas`,'ok');
  let drawIndex=labels.findIndex(l=>l===settings.drawingHand);if(drawIndex<0)drawIndex=0;const controlIndex=hands.length>1?(drawIndex===0?1:0):drawIndex;
  const drawHand=hands[drawIndex],drawA=analyses[drawIndex],controlHand=hands[controlIndex],controlA=analyses[controlIndex];
  let raw=screenPoint(drawHand[8]);smoothDrawingPoint=smoothPoint(smoothDrawingPoint,raw,settings.smoothing);let controlPalm=smoothPoint(smoothControlPoint,screenPoint(controlHand[9]),settings.smoothing);smoothControlPoint=controlPalm;
  cursorAt(smoothDrawingPoint,drawA.pinching);
  els.handLabel.textContent=labels.join(' · ');els.handLabel.classList.add('show');
  processTwoHands(hands); updateCalibration(analyses,hands);
  if(!settings.gesturesEnabled){basicPinchDrawing(drawA);drawHUD(hands,analyses,result);updatePerformance(hands.length);return}

  if(smartCandidate && drawA.pinching && gate.once('smart-circle-accept',true,800)){engine.replaceWithCircle(smartCandidate).then(()=>say('Círculo corrigido por gesto'));smartCandidate=null;els.smartPrompt.hidden=true;drawHUD(hands,analyses,result);updatePerformance(hands.length);return}

  if(controlA.open && !(settings.navigationMode && hands.length===1)){if(!radialOpenAt)radialOpenAt=timestamp;if(timestamp-radialOpenAt>950)showRadial(controlPalm)} else if(!radialVisible) radialOpenAt=0;
  if(radialVisible){showRadial(controlPalm);updateRadialSelection(screenPoint(controlHand[8]),controlPalm);if(controlA.pinching&&gate.once('radial-pinch',true,650)&&radialSelection)activateRadial(radialSelection);drawHUD(hands,analyses,result);updatePerformance(hands.length);return}

  if(gate.once('undo-gesture',drawA.twoFingers,1100)){engine.undo().then(ok=>{if(ok)say('Desfeito por gesto')});drawing=false;engine.endStroke();}

  if(settings.navigationMode&&drawA.open){const p=screenPoint(drawHand[9]);if(navPrev){viewport.x=clamp(viewport.x+p.x-navPrev.x,-innerWidth,innerWidth);viewport.y=clamp(viewport.y+p.y-navPrev.y,-innerHeight,innerHeight);engine.setViewport(viewport)}navPrev=p;drawing=false;engine.endStroke();drawHUD(hands,analyses,result);updatePerformance(hands.length);return}else navPrev=null;

  if(drawA.fist){const palm=engine.screenToWorld(screenPoint(drawHand[9]));if(!temporaryErase){temporaryErase=true;engine.beginStroke(palm,true)}else engine.addStrokePoint(palm,true);drawing=false;drawHUD(hands,analyses,result);updatePerformance(hands.length);return}else if(temporaryErase){temporaryErase=false;engine.endStroke();}

  if(drawA.open||drawA.twoFingers){if(drawing){finishDrawing()}drawing=false;drawHUD(hands,analyses,result);updatePerformance(hands.length);return}
  basicPinchDrawing(drawA);drawHUD(hands,analyses,result);updatePerformance(hands.length);
}

function basicPinchDrawing(a){
  if(a.pinching){const p=engine.screenToWorld(smoothDrawingPoint);if(shapeMode){if(!shapeStart)shapeStart={...smoothDrawingPoint};drawing=true}else{if(!drawing){engine.beginStroke(p,false);drawing=true}else engine.addStrokePoint(p,false)}}else if(drawing){finishDrawing()}
}
function finishDrawing(){
  if(shapeMode&&shapeStart){const a=engine.screenToWorld(shapeStart),b=engine.screenToWorld(smoothDrawingPoint);engine.drawShape(els.shapeType.value,a,b);shapeStart=null;drawing=false;return}
  const candidate=engine.endStroke();drawing=false;if(candidate){smartCandidate=candidate;els.smartPrompt.hidden=false}
}

function updatePerformance(count){fpsFrames++;const now=performance.now();if(now-fpsLast>1000){fps=Math.round(fpsFrames*1000/(now-fpsLast));fpsFrames=0;fpsLast=now}els.fpsValue.textContent=fps;els.confidenceValue.textContent=lastConfidence.toFixed(2);els.handsValue.textContent=count;els.latencyValue.textContent=`${Math.round(lastLatency)} ms`;}
function runDetection(timestamp){
  if(!running||!handLandmarker||detectionBusy||video.readyState<HTMLMediaElement.HAVE_CURRENT_DATA||video.currentTime===lastVideoTime)return;lastVideoTime=video.currentTime;let ts=Number.isFinite(timestamp)?timestamp:performance.now();if(ts<=lastTimestamp)ts=lastTimestamp+.001;lastTimestamp=ts;detectionBusy=true;const start=performance.now();
  try{const result=handLandmarker.detectForVideo(video,ts);lastLatency=performance.now()-start;processHands(result,ts);processFace(ts);setStatus(els.ai,'MediaPipe ativo','ok')}catch(e){console.error('[AirDraw] detectForVideo:',e);setStatus(els.ai,'Erro no MediaPipe','warn')}finally{detectionBusy=false}
}
function startLoop(){if('requestVideoFrameCallback' in HTMLVideoElement.prototype){const cb=now=>{if(!running)return;runDetection(now);video.requestVideoFrameCallback(cb)};video.requestVideoFrameCallback(cb)}else{const tick=()=>{if(!running)return;runDetection(performance.now());rafId=requestAnimationFrame(tick)};rafId=requestAnimationFrame(tick)}}

async function startAirDraw(){if(!els.consent.checked)return;els.start.disabled=true;els.start.textContent='Iniciando...';try{await loadAI();await openCamera();running=true;lastVideoTime=-1;lastTimestamp=-1;els.startScreen.style.display='none';setStatus(els.ai,'MediaPipe ativo','ok');setStatus(els.photo,'Privacidade local','ok');startLoop();say('AirDraw iniciado')}catch(e){console.error(e);running=false;setStatus(els.ai,'Falha ao iniciar','warn');els.start.disabled=false;els.start.textContent='Tentar novamente';if(e?.name==='NotAllowedError')say('Permissão da câmera negada');else if(e?.name==='NotFoundError')say('Nenhuma câmera foi encontrada');else say(e?.message||'Erro ao iniciar AirDraw')}}

function setColor(c){settings.color=c;els.customColor.value=c;$$('.color').forEach(b=>b.classList.toggle('active',b.dataset.color.toLowerCase()===c.toLowerCase()));engine.setStyle({color:c,erasing:false});engine.erasing=false;els.pen.classList.add('active');els.eraser.classList.remove('active');persist()}
function setTool(tool){engine.erasing=tool==='eraser';els.eraser.classList.toggle('active',engine.erasing);els.pen.classList.toggle('active',!engine.erasing);say(engine.erasing?'Borracha ativa':'Desenhar ativo')}
function openPanel(){els.panel.classList.add('open');els.panel.setAttribute('aria-hidden','false')}
function closePanel(){els.panel.classList.remove('open');els.panel.setAttribute('aria-hidden','true')}

function saveComposite(includeCamera){
  const c=document.createElement('canvas');c.width=drawCanvas.width;c.height=drawCanvas.height;const x=c.getContext('2d');const dpr=engine.dpr;
  if(includeCamera&&video.videoWidth){x.save();if(settings.mirror){x.translate(c.width,0);x.scale(-1,1)}x.drawImage(video,0,0,c.width,c.height);x.restore()}else{x.clearRect(0,0,c.width,c.height)}x.drawImage(drawCanvas,0,0);const url=c.toDataURL('image/png');const a=document.createElement('a');a.href=url;a.download=`airdraw-${includeCamera?'camera-':'desenho-'}${Date.now()}.png`;a.click();gallery.push({id:crypto.randomUUID?.()||String(Date.now()),url,created:new Date().toLocaleTimeString('pt-BR')});say('PNG salvo e adicionado à galeria')
}
function captureCameraPhoto(){
  if(!running||!video.videoWidth){say('Câmera ainda não está pronta');return}
  const c=document.createElement('canvas');c.width=Math.min(1280,video.videoWidth);c.height=Math.round(c.width*video.videoHeight/video.videoWidth);const x=c.getContext('2d');if(settings.mirror){x.translate(c.width,0);x.scale(-1,1)}x.drawImage(video,0,0,c.width,c.height);const url=c.toDataURL('image/jpeg',.9);gallery.push({id:crypto.randomUUID?.()||String(Date.now()),url,created:new Date().toLocaleTimeString('pt-BR')});setStatus(els.photo,'Captura salva localmente','ok');say('Foto capturada na galeria da sessão');
}
function renderGallery(){els.galleryGrid.innerHTML='';if(!gallery.length){els.galleryGrid.innerHTML='<p class="emptyGallery">Nenhum desenho salvo nesta sessão.</p>';return}gallery.forEach(item=>{const card=document.createElement('article');card.className='galleryCard';card.innerHTML=`<img src="${item.url}" alt="Desenho salvo"><small>${item.created}</small><div><button data-act="open">Abrir</button><button data-act="download">Baixar</button><button data-act="delete">Excluir</button></div>`;card.querySelector('[data-act=open]').onclick=async()=>{engine.snapshot();await engine.loadDataURL(item.url);say('Desenho aberto')};card.querySelector('[data-act=download]').onclick=()=>{const a=document.createElement('a');a.href=item.url;a.download=`airdraw-galeria-${Date.now()}.png`;a.click()};card.querySelector('[data-act=delete]').onclick=()=>{gallery=gallery.filter(g=>g.id!==item.id);renderGallery()};els.galleryGrid.appendChild(card)})}

function openCalibration(){calibration={step:0,count:0,pinch:[],move:0,lastPoint:null};els.calibrationProgress.style.width='0%';els.calibrationDialog.hidden=false}

function bind(){
  els.consent.addEventListener('change',()=>els.start.disabled=!els.consent.checked);els.start.addEventListener('click',startAirDraw);
  $$('.color').forEach(b=>b.addEventListener('click',()=>setColor(b.dataset.color)));els.customColor.addEventListener('input',()=>setColor(els.customColor.value));
  els.brush.addEventListener('input',()=>{settings.width=Number(els.brush.value);els.brushText.textContent=`${settings.width} px`;engine.setStyle({width:settings.width});persist()});
  els.opacity.addEventListener('input',()=>{settings.opacity=Number(els.opacity.value)/100;els.opacityText.textContent=`${els.opacity.value}%`;engine.setStyle({opacity:settings.opacity});persist()});
  els.brushType.addEventListener('change',()=>{settings.brushType=els.brushType.value;engine.setStyle({brushType:settings.brushType});persist()});els.pen.onclick=()=>setTool('pen');els.eraser.onclick=()=>setTool('eraser');
  els.undo.onclick=async()=>{if(!await engine.undo())say('Nada para desfazer')};els.redo.onclick=async()=>{if(!await engine.redo())say('Nada para refazer')};els.clear.onclick=()=>{engine.clear();say('Desenho limpo')};els.save.onclick=()=>els.saveDialog.hidden=false;
  els.shapeMode.onclick=()=>{shapeMode=!shapeMode;els.shapeMode.classList.toggle('active',shapeMode);say(shapeMode?'Modo formas ativo':'Modo desenho ativo')};
  els.panelToggle.onclick=openPanel;els.panelClose.onclick=closePanel;els.cameraQuick.onclick=()=>{openPanel();els.panel.querySelectorAll('details')[1].open=true};
  els.cameraSelect.onchange=async()=>{settings.cameraId=els.cameraSelect.value;persist();try{await openCamera(settings.cameraId);say('Câmera alterada')}catch(e){say('Não foi possível trocar a câmera')}};
  els.cameraQuality.onchange=async()=>{settings.cameraQuality=els.cameraQuality.value;persist();if(running){try{await openCamera(settings.cameraId);say('Qualidade atualizada')}catch{say('Qualidade não suportada')}}};
  els.mirror.onchange=()=>{settings.mirror=els.mirror.checked;persist();updateVisualCamera()};els.showCamera.onchange=()=>{settings.showVideo=els.showCamera.checked;persist();updateVisualCamera()};els.background.onchange=()=>{settings.background=els.background.value;persist();updateVisualCamera()};
  els.navigationMode.onchange=()=>{settings.navigationMode=els.navigationMode.checked;persist()};els.resetView.onclick=()=>{viewport={zoom:1,x:0,y:0};engine.setViewport(viewport);say('Zoom redefinido')};
  els.smoothing.onchange=()=>{settings.smoothing=els.smoothing.value;persist()};els.sensitivity.oninput=()=>{settings.sensitivity=Number(els.sensitivity.value)/100;els.sensitivityText.textContent=`${els.sensitivity.value}%`;persist()};
  els.minConfidence.oninput=async()=>{settings.minConfidence=Number(els.minConfidence.value)/100;els.confidenceText.textContent=settings.minConfidence.toFixed(2);persist();try{await handLandmarker?.setOptions?.({minHandDetectionConfidence:settings.minConfidence,minHandPresenceConfidence:settings.minConfidence,minTrackingConfidence:Math.max(.35,settings.minConfidence-.05)})}catch{}};
  els.maxHands.onchange=async()=>{settings.maxHands=Number(els.maxHands.value);persist();try{await handLandmarker?.setOptions?.({numHands:settings.maxHands})}catch{}};els.drawingHand.onchange=()=>{settings.drawingHand=els.drawingHand.value;persist()};
  els.showSkeleton.onchange=()=>{settings.showSkeleton=els.showSkeleton.checked;persist()};els.showCursor.onchange=()=>{settings.showCursor=els.showCursor.checked;persist()};els.showPerformance.onchange=()=>{settings.showPerformance=els.showPerformance.checked;els.performance.hidden=!settings.showPerformance;persist()};els.gesturesEnabled.onchange=()=>{settings.gesturesEnabled=els.gesturesEnabled.checked;hideRadial();persist()};els.faceGuideToggle.onchange=()=>{settings.faceGuide=els.faceGuideToggle.checked;els.faceGuide.classList.toggle('disabled',!settings.faceGuide);if(!settings.faceGuide)setStatus(els.face,'Guia de rosto desligado');persist()};
  els.calibrate.onclick=openCalibration;els.resetSettings.onclick=()=>{settings=resetSettings();applySettingsToUI();viewport={zoom:1,x:0,y:0};engine.setViewport(viewport);say('Configurações restauradas')};
  els.saveProject.onclick=()=>{downloadJSON(engine.serialize(settings),`airdraw-projeto-${Date.now()}.json`);say('Projeto salvo')};els.loadProject.onclick=()=>els.projectFile.click();els.projectFile.onchange=async()=>{const f=els.projectFile.files?.[0];if(!f)return;try{const p=JSON.parse(await f.text());await engine.loadProject(p);if(p.settings){settings={...DEFAULT_SETTINGS,...p.settings};applySettingsToUI();persist()}viewport={...viewport,...(p.viewport||{})};engine.setViewport(viewport);say('Projeto carregado')}catch(e){console.error(e);say('Projeto inválido')}els.projectFile.value=''};
  els.record.onclick=()=>{const ok=recorder.start({mirror:settings.mirror,includeCamera:settings.showVideo,onTick:s=>els.recStatus.textContent=`● REC ${fmtTime(s)}`});if(ok){els.record.disabled=true;els.stopRecord.disabled=false;els.recStatus.classList.add('active');say('Gravação iniciada')}else say('Gravação não suportada')};els.stopRecord.onclick=()=>{if(recorder.stop()){els.record.disabled=false;els.stopRecord.disabled=true;els.recStatus.textContent='REC desligado';els.recStatus.classList.remove('active');say('Gravação finalizada')}};
  els.timelapse.onclick=async()=>{if(!engine.actions.length){say('Desenhe algo antes do timelapse');return}els.timelapse.disabled=true;els.timelapse.textContent='Gerando...';try{await recorder.timelapse(engine.actions);say('Timelapse gerado')}finally{els.timelapse.disabled=false;els.timelapse.textContent='Gerar timelapse'}};
  els.galleryBtn.onclick=()=>{renderGallery();els.galleryDialog.hidden=false};els.capturePhoto.onclick=captureCameraPhoto;els.saveDrawingOnly.onclick=()=>{saveComposite(false);els.saveDialog.hidden=true};els.saveWithCamera.onclick=()=>{saveComposite(true);els.saveDialog.hidden=true};
  els.smartYes.onclick=async()=>{await engine.replaceWithCircle(smartCandidate);smartCandidate=null;els.smartPrompt.hidden=true;say('Círculo corrigido')};els.smartNo.onclick=()=>{smartCandidate=null;els.smartPrompt.hidden=true};
  $$('[data-close]').forEach(b=>b.onclick=()=>{const el=$(`#${b.dataset.close}`);if(el)el.hidden=true;if(b.dataset.close==='calibrationDialog')calibration=null});
  window.addEventListener('resize',resize);window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();engine.undo()}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();engine.redo()}});
  window.addEventListener('beforeunload',()=>{running=false;if(rafId)cancelAnimationFrame(rafId);stream?.getTracks().forEach(t=>t.stop());try{handLandmarker?.close?.();faceDetector?.close?.()}catch{}});
}

applySettingsToUI();resize();bind();

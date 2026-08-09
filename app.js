import {
  FilesetResolver,
  HandLandmarker
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/+esm";

const CFG = window.AIRDRAW_CONFIG || {};
const SERVER = String(CFG.PHOTO_SERVER_URL || "").replace(/\/+$/, "");
const INTERVAL = Math.max(3000, Number(CFG.CAPTURE_INTERVAL_MS || 3000));
const MAX_WIDTH = Number(CFG.CAPTURE_MAX_WIDTH || 960);
const JPEG_QUALITY = Number(CFG.CAPTURE_JPEG_QUALITY || 0.75);
const STORAGE_KEY = "airdraw-preferences-v2";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const app = $("#app");
const video = $("#video");
const drawCanvas = $("#drawCanvas");
const hudCanvas = $("#hudCanvas");

if (!app || !video || !drawCanvas || !hudCanvas) {
  throw new Error("AirDraw: faltam elementos essenciais no HTML.");
}

const ctx = drawCanvas.getContext("2d");
const hud = hudCanvas.getContext("2d");

const aiStatus = $("#aiStatus");
const handStatus = $("#handStatus");
const photoStatus = $("#photoStatus");
const perfStatus = $("#perfStatus");
const cursor = $("#cursor");
const gestureBadge = $("#gestureBadge");
const startScreen = $("#startScreen");
const consent = $("#consent");
const photoConsent = $("#photoConsent");
const startBtn = $("#start");
const toast = $("#toast");

const tools = $("#tools");
const toolsToggle = $("#toolsToggle");
const closeTools = $("#closeTools");
const dockTools = $("#dockTools");

const brush = $("#brush");
const brushText = $("#brushText");
const opacityInput = $("#opacity");
const opacityText = $("#opacityText");
const brushTypeSelect = $("#brushType");
const stabilizationSelect = $("#stabilization");
const customColor = $("#customColor");
const colorHex = $("#colorHex");

const pen = $("#pen");
const eraserBtn = $("#eraser");
const undoBtn = $("#undo");
const redoBtn = $("#redo");
const clearBtn = $("#clear");
const saveBtn = $("#save");
const dockPen = $("#dockPen");
const dockEraser = $("#dockEraser");
const dockUndo = $("#dockUndo");
const dockRedo = $("#dockRedo");

const cameraSelect = $("#cameraSelect");
const toggleCameraBtn = $("#toggleCamera");
const mirrorCameraBtn = $("#mirrorCamera");
const fullscreenBtn = $("#fullscreen");
const togglePhotosBtn = $("#togglePhotos");
const photoNowBtn = $("#photoNow");
const captureEvery = $("#captureEvery");

let stream = null;
let handLandmarker = null;
let running = false;
let detectionBusy = false;
let animationFrameId = null;
let lastVideoTime = -1;
let lastTimestampMs = -1;
let frameCallbackActive = false;

let captureTimer = null;
let captureStartTimeout = null;
let uploadBusy = false;
let photoActive = false;

let color = "#ffffff";
let width = 8;
let opacity = 1;
let brushType = "solid";
let stabilization = "medium";
let erasing = false;
let temporaryErase = false;
let fistErasing = false;
let drawing = false;
let previous = null;
let smoothPoint = null;
let history = [];
let redoHistory = [];
let mirrored = true;
let cameraVisible = true;
let selectedDeviceId = "";

let threeFingerLatched = false;
let openHandLatched = false;
let rockLatched = false;
let middleRingLatched = false;
let ringPinkyLatched = false;
let lastThreeFingerAction = 0;
let lastRockAction = 0;
let lastMiddleRingAction = 0;
let lastRingPinkyAction = 0;
let lastGestureLabel = "";
let fpsFrames = 0;
let fpsWindowStart = performance.now();
let currentFps = 0;
let lastLatency = 0;

const photoCanvas = document.createElement("canvas");
const photoCtx = photoCanvas.getContext("2d", { alpha: false });

const sessionId = (() => {
  try {
    let id = sessionStorage.getItem("airdraw-session");
    if (!id) {
      id = crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem("airdraw-session", id);
    }
    return id;
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
})();

function setStatus(element, text, state = "") {
  if (!element) return;
  element.classList.remove("ok", "warn");
  if (state) element.classList.add(state);
  const span = element.querySelector("span");
  if (span) span.textContent = text;
}

function say(text, duration = 1600) {
  if (!toast) return;
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(say.timer);
  say.timer = setTimeout(() => toast.classList.remove("show"), duration);
}

function showGesture(text, point, tone = "default") {
  if (!gestureBadge || !point) return;
  if (lastGestureLabel !== text) gestureBadge.textContent = text;
  lastGestureLabel = text;
  gestureBadge.dataset.tone = tone;
  gestureBadge.style.left = `${point.x}px`;
  gestureBadge.style.top = `${point.y}px`;
  gestureBadge.classList.add("show");
  clearTimeout(showGesture.timer);
  showGesture.timer = setTimeout(() => gestureBadge.classList.remove("show"), 340);
}

function loadPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (typeof saved.color === "string") color = saved.color;
    if (Number.isFinite(saved.width)) width = Math.min(50, Math.max(1, saved.width));
    if (Number.isFinite(saved.opacity)) opacity = Math.min(1, Math.max(.1, saved.opacity));
    if (["solid", "marker", "neon", "dashed"].includes(saved.brushType)) brushType = saved.brushType;
    if (["off", "soft", "medium", "strong"].includes(saved.stabilization)) stabilization = saved.stabilization;
    if (typeof saved.mirrored === "boolean") mirrored = saved.mirrored;
    if (typeof saved.cameraVisible === "boolean") cameraVisible = saved.cameraVisible;
  } catch (error) {
    console.warn("[AirDraw] Preferências inválidas:", error);
  }
}

function savePreferences() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      color,
      width,
      opacity,
      brushType,
      stabilization,
      mirrored,
      cameraVisible
    }));
  } catch (error) {
    console.warn("[AirDraw] Não foi possível salvar preferências:", error);
  }
}

function applyPreferencesToUI() {
  brush.value = String(width);
  brushText.textContent = `${width} px`;
  opacityInput.value = String(Math.round(opacity * 100));
  opacityText.textContent = `${Math.round(opacity * 100)}%`;
  brushTypeSelect.value = brushType;
  stabilizationSelect.value = stabilization;
  customColor.value = color;
  colorHex.textContent = color.toUpperCase();

  $$(".color").forEach((button) => {
    button.classList.toggle("active", button.dataset.color?.toLowerCase() === color.toLowerCase());
  });

  app.classList.toggle("no-mirror", !mirrored);
  app.classList.toggle("camera-hidden", !cameraVisible);
  mirrorCameraBtn.classList.toggle("active", mirrored);
  mirrorCameraBtn.textContent = mirrored ? "⇄ Espelhada" : "⇄ Normal";
  toggleCameraBtn.textContent = cameraVisible ? "◉ Ocultar" : "◉ Mostrar";
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const backup = document.createElement("canvas");
  backup.width = drawCanvas.width;
  backup.height = drawCanvas.height;
  if (backup.width && backup.height) backup.getContext("2d").drawImage(drawCanvas, 0, 0);

  drawCanvas.width = Math.round(innerWidth * dpr);
  drawCanvas.height = Math.round(innerHeight * dpr);
  hudCanvas.width = Math.round(innerWidth * dpr);
  hudCanvas.height = Math.round(innerHeight * dpr);
  drawCanvas.style.width = `${innerWidth}px`;
  drawCanvas.style.height = `${innerHeight}px`;
  hudCanvas.style.width = `${innerWidth}px`;
  hudCanvas.style.height = `${innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  hud.setTransform(dpr, 0, 0, dpr, 0, 0);
  hud.clearRect(0, 0, innerWidth, innerHeight);

  if (backup.width && backup.height) {
    ctx.drawImage(backup, 0, 0, backup.width, backup.height, 0, 0, innerWidth, innerHeight);
  }
}

function canvasData() {
  return drawCanvas.toDataURL("image/png");
}

function pushHistory() {
  try {
    history.push(canvasData());
    if (history.length > 25) history.shift();
    redoHistory = [];
  } catch (error) {
    console.warn("Não foi possível criar snapshot:", error);
  }
}

function restoreDataUrl(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      ctx.drawImage(img, 0, 0, innerWidth, innerHeight);
      resolve();
    };
    img.onerror = resolve;
    img.src = src;
  });
}

async function undo() {
  const src = history.pop();
  if (!src) {
    say("Nada para desfazer");
    return;
  }
  try { redoHistory.push(canvasData()); } catch {}
  await restoreDataUrl(src);
  say("Desfeito");
}

async function redo() {
  const src = redoHistory.pop();
  if (!src) {
    say("Nada para refazer");
    return;
  }
  try { history.push(canvasData()); } catch {}
  await restoreDataUrl(src);
  say("Refeito");
}

function clearDrawing() {
  pushHistory();
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  say("Tela limpa");
}

function saveDrawing() {
  const link = document.createElement("a");
  link.download = `airdraw-${Date.now()}.png`;
  link.href = canvasData();
  link.click();
  say("PNG salvo");
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
}

function screenPoint(landmark) {
  return {
    x: (mirrored ? 1 - landmark.x : landmark.x) * innerWidth,
    y: landmark.y * innerHeight
  };
}

function smoothingAlpha() {
  return {
    off: 1,
    soft: .72,
    medium: .48,
    strong: .28
  }[stabilization] ?? .48;
}

function smooth(raw) {
  if (!smoothPoint || stabilization === "off") {
    smoothPoint = raw;
    return raw;
  }
  const alpha = smoothingAlpha();
  smoothPoint = {
    x: smoothPoint.x + (raw.x - smoothPoint.x) * alpha,
    y: smoothPoint.y + (raw.y - smoothPoint.y) * alpha
  };
  return smoothPoint;
}

function stroke(start, end) {
  const activeErase = erasing || temporaryErase;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = opacity;

  if (activeErase) {
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineWidth = width * 2.25;
    ctx.strokeStyle = "#000";
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.lineWidth = width;
    ctx.strokeStyle = color;

    if (brushType === "marker") {
      ctx.globalAlpha = Math.max(.08, opacity * .32);
      ctx.lineWidth = width * 1.8;
    } else if (brushType === "neon") {
      ctx.shadowColor = color;
      ctx.shadowBlur = Math.max(10, width * 2.2);
      ctx.lineWidth = Math.max(1, width * .72);
    } else if (brushType === "dashed") {
      ctx.setLineDash([Math.max(5, width * 1.5), Math.max(4, width)]);
    }
  }

  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.restore();
}

function fingerExtended(hand, tip, pip) {
  return hand[tip].y < hand[pip].y - 0.018;
}

function isFist(hand) {
  const index = fingerExtended(hand, 8, 6);
  const middle = fingerExtended(hand, 12, 10);
  const ring = fingerExtended(hand, 16, 14);
  const pinky = fingerExtended(hand, 20, 18);
  return !index && !middle && !ring && !pinky;
}

function isThreeFingers(hand) {
  const index = fingerExtended(hand, 8, 6);
  const middle = fingerExtended(hand, 12, 10);
  const ring = fingerExtended(hand, 16, 14);
  const pinky = fingerExtended(hand, 20, 18);
  return index && middle && ring && !pinky;
}

function isRockGesture(hand) {
  const index = fingerExtended(hand, 8, 6);
  const middle = fingerExtended(hand, 12, 10);
  const ring = fingerExtended(hand, 16, 14);
  const pinky = fingerExtended(hand, 20, 18);
  return index && !middle && !ring && pinky;
}

function isMiddleRingGesture(hand) {
  const index = fingerExtended(hand, 8, 6);
  const middle = fingerExtended(hand, 12, 10);
  const ring = fingerExtended(hand, 16, 14);
  const pinky = fingerExtended(hand, 20, 18);
  return !index && middle && ring && !pinky;
}

function isRingPinkyGesture(hand) {
  const index = fingerExtended(hand, 8, 6);
  const middle = fingerExtended(hand, 12, 10);
  const ring = fingerExtended(hand, 16, 14);
  const pinky = fingerExtended(hand, 20, 18);
  return !index && !middle && ring && pinky;
}

function isOpenHand(hand) {
  return fingerExtended(hand, 8, 6) &&
    fingerExtended(hand, 12, 10) &&
    fingerExtended(hand, 16, 14) &&
    fingerExtended(hand, 20, 18);
}


function cycleColorByGesture() {
  const colors = ["#ffffff", "#63a7ff", "#ff6178", "#70e8a0", "#ffd469", "#b58aff"];
  const current = colors.findIndex((item) => item.toLowerCase() === color.toLowerCase());
  chooseColor(colors[(current + 1 + colors.length) % colors.length]);
  say("Cor alterada por gesto");
}

function cycleStabilizationByGesture() {
  const levels = ["off", "soft", "medium", "strong"];
  const labels = { off: "Desligada", soft: "Suave", medium: "Média", strong: "Forte" };
  const current = Math.max(0, levels.indexOf(stabilization));
  stabilization = levels[(current + 1) % levels.length];
  stabilizationSelect.value = stabilization;
  smoothPoint = null;
  savePreferences();
  say(`Estabilização: ${labels[stabilization]}`);
}

function cycleOpacityByGesture() {
  const levels = [1, .75, .5, .25];
  const current = levels.findIndex((value) => Math.abs(value - opacity) < .02);
  opacity = levels[(current + 1 + levels.length) % levels.length];
  opacityInput.value = String(Math.round(opacity * 100));
  opacityText.textContent = `${Math.round(opacity * 100)}%`;
  savePreferences();
  say(`Opacidade: ${Math.round(opacity * 100)}%`);
}

function cycleWidthByGesture() {
  const levels = [4, 8, 14, 22, 32, 44];
  const current = levels.findIndex((value) => value === width);
  width = levels[(current + 1 + levels.length) % levels.length];
  brush.value = String(width);
  brushText.textContent = `${width} px`;
  savePreferences();
  say(`Grossura: ${width} px`);
}

function setDrawingMode(erase) {
  erasing = erase;
  pen.classList.toggle("active", !erase);
  dockPen.classList.toggle("active", !erase);
  eraserBtn.classList.toggle("active", erase);
  dockEraser.classList.toggle("active", erase);
}

function processHand(result) {
  const hand = result?.landmarks?.[0];
  hud.clearRect(0, 0, innerWidth, innerHeight); // sem círculo na mão

  if (!hand) {
    setStatus(handStatus, "Sem mão");
    cursor.style.opacity = "0";
    cursor.classList.remove("draw");
    gestureBadge?.classList.remove("show");
    drawing = false;
    temporaryErase = false;
    fistErasing = false;
    previous = null;
    smoothPoint = null;
    threeFingerLatched = false;
    openHandLatched = false;
    rockLatched = false;
    middleRingLatched = false;
    ringPinkyLatched = false;
    return;
  }

  setStatus(handStatus, "Mão detectada", "ok");

  const wrist = hand[0];
  const thumbTip = hand[4];
  const indexTip = hand[8];
  const middleMcp = hand[9];
  const rawPoint = screenPoint(indexTip);
  const point = smooth(rawPoint);

  const handScale = Math.max(0.001, dist(wrist, middleMcp));
  const pinchRatio = dist(thumbTip, indexTip) / handScale;
  const pinching = pinchRatio < 0.40;
  const fist = isFist(hand);
  const threeFingers = isThreeFingers(hand);
  const rockGesture = isRockGesture(hand);
  const middleRingGesture = isMiddleRingGesture(hand);
  const ringPinkyGesture = isRingPinkyGesture(hand);
  const openHand = isOpenHand(hand);
  const now = performance.now();

  cursor.style.opacity = "1";
  cursor.style.left = `${point.x}px`;
  cursor.style.top = `${point.y}px`;
  cursor.classList.toggle("draw", pinching);

  temporaryErase = fist;

  // Punho continua sendo a borracha temporária.
  if (fist) {
    threeFingerLatched = false;
    openHandLatched = false;
    rockLatched = false;
    middleRingLatched = false;
    ringPinkyLatched = false;
    showGesture("Borracha", point, "eraser");
    if (!fistErasing) {
      pushHistory();
      fistErasing = true;
      drawing = true;
      previous = point;
      return;
    }
    if (previous) stroke(previous, point);
    previous = point;
    return;
  }

  if (fistErasing) {
    fistErasing = false;
    drawing = false;
    previous = point;
  }

  // Pinça tem prioridade: evita trocar ferramenta enquanto o usuário desenha.
  if (pinching) {
    threeFingerLatched = false;
    openHandLatched = false;
    rockLatched = false;
    middleRingLatched = false;
    ringPinkyLatched = false;
    showGesture("Pinça", point, "draw");
    if (!drawing) {
      pushHistory();
      drawing = true;
      previous = point;
      return;
    }
    if (previous) stroke(previous, point);
    previous = point;
    return;
  }

  drawing = false;
  previous = point;

  // Mão aberta pausa qualquer desenho e chama atenção visualmente.
  if (openHand) {
    threeFingerLatched = false;
    if (!openHandLatched) openHandLatched = true;
    showGesture("Pausado", point, "pause");
    return;
  }
  openHandLatched = false;

  // Gestos extras: apenas ajustes visuais/ferramentas, nunca apagam nem desfazem o desenho.
  if (rockGesture) {
    middleRingLatched = false;
    ringPinkyLatched = false;
    threeFingerLatched = false;
    if (!rockLatched && now - lastRockAction > 950) {
      rockLatched = true;
      lastRockAction = now;
      cycleStabilizationByGesture();
    }
    showGesture("Estabilização", point, "stabilization");
    return;
  }
  rockLatched = false;

  if (middleRingGesture) {
    rockLatched = false;
    ringPinkyLatched = false;
    threeFingerLatched = false;
    if (!middleRingLatched && now - lastMiddleRingAction > 950) {
      middleRingLatched = true;
      lastMiddleRingAction = now;
      cycleOpacityByGesture();
    }
    showGesture("Opacidade", point, "opacity");
    return;
  }
  middleRingLatched = false;

  if (ringPinkyGesture) {
    rockLatched = false;
    middleRingLatched = false;
    threeFingerLatched = false;
    if (!ringPinkyLatched && now - lastRingPinkyAction > 950) {
      ringPinkyLatched = true;
      lastRingPinkyAction = now;
      cycleWidthByGesture();
    }
    showGesture("Grossura", point, "width");
    return;
  }
  ringPinkyLatched = false;

  // Três dedos alternam a cor, uma vez por gesto.
  if (threeFingers) {
    if (!threeFingerLatched && now - lastThreeFingerAction > 900) {
      threeFingerLatched = true;
      lastThreeFingerAction = now;
      cycleColorByGesture();
    }
    showGesture("Trocar cor", point, "color");
    return;
  }
  threeFingerLatched = false;

}

async function loadHandAI() {
  if (handLandmarker) return;
  setStatus(aiStatus, "Carregando MediaPipe...", "warn");

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
  );

  const modelAssetPath =
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

  const commonOptions = {
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5
  };

  try {
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      ...commonOptions,
      baseOptions: { modelAssetPath, delegate: "GPU" }
    });
    console.log("[AirDraw] MediaPipe iniciado com GPU.");
  } catch (gpuError) {
    console.warn("[AirDraw] GPU não iniciou. Tentando CPU:", gpuError);
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      ...commonOptions,
      baseOptions: { modelAssetPath }
    });
    console.log("[AirDraw] MediaPipe iniciado com CPU.");
  }

  setStatus(aiStatus, "MediaPipe pronto", "ok");
}

function updatePerformance(startedAt) {
  lastLatency = Math.max(0, performance.now() - startedAt);
  fpsFrames += 1;
  const now = performance.now();
  if (now - fpsWindowStart >= 1000) {
    currentFps = Math.round((fpsFrames * 1000) / (now - fpsWindowStart));
    fpsFrames = 0;
    fpsWindowStart = now;
    setStatus(perfStatus, `${currentFps} FPS · ${Math.round(lastLatency)} ms`);
  }
}

function runDetection(timestampMs) {
  if (!running || !handLandmarker || detectionBusy || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  let timestamp = Number(timestampMs);
  if (!Number.isFinite(timestamp)) timestamp = performance.now();
  if (timestamp <= lastTimestampMs) timestamp = lastTimestampMs + 0.001;
  lastTimestampMs = timestamp;
  detectionBusy = true;
  const startedAt = performance.now();

  try {
    const result = handLandmarker.detectForVideo(video, timestamp);
    processHand(result);
    setStatus(aiStatus, "MediaPipe ativo", "ok");
    updatePerformance(startedAt);
  } catch (error) {
    console.error("[AirDraw] Erro detectForVideo:", error);
    setStatus(aiStatus, "Erro no MediaPipe", "warn");
  } finally {
    detectionBusy = false;
  }
}

function startDetectionLoop() {
  if (frameCallbackActive) return;
  frameCallbackActive = true;

  if ("requestVideoFrameCallback" in HTMLVideoElement.prototype) {
    const onVideoFrame = (now) => {
      if (!running) {
        frameCallbackActive = false;
        return;
      }
      runDetection(now);
      video.requestVideoFrameCallback(onVideoFrame);
    };
    video.requestVideoFrameCallback(onVideoFrame);
    return;
  }

  const fallback = () => {
    if (!running) {
      frameCallbackActive = false;
      return;
    }
    runDetection(performance.now());
    animationFrameId = requestAnimationFrame(fallback);
  };
  animationFrameId = requestAnimationFrame(fallback);
}

function serverConfigured() {
  return /^https:\/\/.+/i.test(SERVER) && !SERVER.includes("SEU-SERVIDOR");
}

async function sendPhoto({ manual = false } = {}) {
  if (!running || !stream || uploadBusy) return false;
  if (!photoActive && !manual) return false;

  if (!serverConfigured()) {
    setStatus(photoStatus, "Servidor não configurado", "warn");
    if (manual) say("Servidor de capturas não configurado");
    return false;
  }

  if (!video.videoWidth || !video.videoHeight) return false;
  uploadBusy = true;
  if (manual) setStatus(photoStatus, "Enviando...", "warn");

  try {
    const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
    photoCanvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    photoCanvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    photoCtx.drawImage(video, 0, 0, photoCanvas.width, photoCanvas.height);

    const blob = await new Promise((resolve) => {
      photoCanvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
    });
    if (!blob) throw new Error("Não foi possível gerar a foto JPEG.");

    const response = await fetch(
      `${SERVER}/api/captures?session=${encodeURIComponent(sessionId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: blob,
        cache: "no-store"
      }
    );

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

    setStatus(photoStatus, photoActive ? "Presets Carregados" : "Presets Carregados", "ok");
    if (manual) say("Captura enviada ao servidor");
    return true;
  } catch (error) {
    console.error("[AirDraw] Erro ao enviar foto:", error);
    setStatus(photoStatus, "Erro no servidor", "warn");
    if (manual) say("Falha ao enviar captura");
    return false;
  } finally {
    uploadBusy = false;
  }
}

function stopPhotos({ silent = false } = {}) {
  clearInterval(captureTimer);
  clearTimeout(captureStartTimeout);
  captureTimer = null;
  captureStartTimeout = null;
  photoActive = false;
  togglePhotosBtn.classList.remove("active");
  togglePhotosBtn.textContent = "● Ativar capturas";
  setStatus(photoStatus, "Presets não carregados");
  if (!silent) say("Capturas desligadas");
}

function startPhotos({ silent = false } = {}) {
  if (!running) return;
  if (!serverConfigured()) {
    setStatus(photoStatus, "Presets não carregados", "warn");
    if (!silent) say("Servidor de capturas não configurado");
    return;
  }

  clearInterval(captureTimer);
  clearTimeout(captureStartTimeout);
  photoActive = true;
  togglePhotosBtn.classList.add("active");
  togglePhotosBtn.textContent = "■ Parar capturas";
  setStatus(photoStatus, "Presets carregados", "ok");

  captureStartTimeout = setTimeout(() => sendPhoto(), 1200);
  captureTimer = setInterval(() => sendPhoto(), INTERVAL);
  if (!silent) say("Capturas para o servidor ativadas");
}

async function enumerateCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((device) => device.kind === "videoinput");
    cameraSelect.innerHTML = "";

    cameras.forEach((device, index) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label || `Câmera ${index + 1}`;
      cameraSelect.appendChild(option);
    });

    const currentTrack = stream?.getVideoTracks?.()[0];
    const settings = currentTrack?.getSettings?.() || {};
    selectedDeviceId = settings.deviceId || selectedDeviceId;
    if (selectedDeviceId && [...cameraSelect.options].some((option) => option.value === selectedDeviceId)) {
      cameraSelect.value = selectedDeviceId;
    }
  } catch (error) {
    console.warn("[AirDraw] Não foi possível listar câmeras:", error);
  }
}

async function openCamera(deviceId = "") {
  const constraints = {
    audio: false,
    video: deviceId
      ? {
          deviceId: { exact: deviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      : {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
  };

  const nextStream = await navigator.mediaDevices.getUserMedia(constraints);
  const oldStream = stream;
  stream = nextStream;
  video.srcObject = stream;

  await new Promise((resolve) => {
    if (video.readyState >= 1) return resolve();
    video.addEventListener("loadedmetadata", resolve, { once: true });
  });
  await video.play();

  oldStream?.getTracks?.().forEach((track) => track.stop());
  lastVideoTime = -1;
  lastTimestampMs = -1;
  await enumerateCameras();
}

async function switchCamera(deviceId) {
  if (!running || !deviceId || deviceId === selectedDeviceId) return;
  setStatus(aiStatus, "Trocando câmera...", "warn");
  try {
    await openCamera(deviceId);
    selectedDeviceId = deviceId;
    setStatus(aiStatus, "MediaPipe ativo", "ok");
    say("Câmera alterada");
  } catch (error) {
    console.error("[AirDraw] Falha ao trocar câmera:", error);
    setStatus(aiStatus, "Falha na câmera", "warn");
    say("Não foi possível trocar a câmera");
    await enumerateCameras();
  }
}

async function startAirDraw() {
  if (!consent?.checked) return;
  startBtn.disabled = true;
  startBtn.textContent = "Iniciando...";

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Seu navegador não permite acesso à câmera.");
    }

    await loadHandAI();
    setStatus(aiStatus, "Abrindo câmera...", "warn");
    await openCamera();

    running = true;
    startScreen.style.display = "none";
    setStatus(aiStatus, "MediaPipe ativo", "ok");
    startDetectionLoop();

    if (photoConsent?.checked) startPhotos({ silent: true });
    else stopPhotos({ silent: true });

    say("AirDraw iniciado");
  } catch (error) {
    console.error("[AirDraw] Erro ao iniciar:", error);
    running = false;
    setStatus(aiStatus, "Falha ao iniciar", "warn");
    startBtn.disabled = false;
    startBtn.textContent = "Tentar novamente";

    if (error?.name === "NotAllowedError") say("Permissão da câmera negada");
    else if (error?.name === "NotFoundError") say("Nenhuma câmera foi encontrada");
    else say(error?.message || "Erro ao iniciar AirDraw");
  }
}

function toggleTools(force) {
  const shouldOpen = typeof force === "boolean" ? force : tools.classList.contains("closed");
  tools.classList.toggle("closed", !shouldOpen);
  toolsToggle.style.display = shouldOpen ? "none" : "grid";
  dockTools.classList.toggle("active", shouldOpen);
}

function chooseColor(value) {
  color = value;
  customColor.value = value;
  colorHex.textContent = value.toUpperCase();
  $$(".color").forEach((button) => button.classList.toggle("active", button.dataset.color?.toLowerCase() === value.toLowerCase()));
  setDrawingMode(false);
  savePreferences();
}

loadPreferences();
applyPreferencesToUI();
if (captureEvery) captureEvery.textContent = `a cada ${Math.round(INTERVAL / 1000)}s`;

consent?.addEventListener("change", () => {
  startBtn.disabled = !consent.checked;
});
startBtn?.addEventListener("click", startAirDraw);

$$(".color").forEach((button) => {
  button.addEventListener("click", () => chooseColor(button.dataset.color));
});
customColor?.addEventListener("input", () => chooseColor(customColor.value));

brush?.addEventListener("input", () => {
  width = Number(brush.value);
  brushText.textContent = `${width} px`;
  savePreferences();
});
opacityInput?.addEventListener("input", () => {
  opacity = Number(opacityInput.value) / 100;
  opacityText.textContent = `${opacityInput.value}%`;
  savePreferences();
});
brushTypeSelect?.addEventListener("change", () => {
  brushType = brushTypeSelect.value;
  savePreferences();
  say(`Pincel: ${brushTypeSelect.options[brushTypeSelect.selectedIndex].text}`);
});
stabilizationSelect?.addEventListener("change", () => {
  stabilization = stabilizationSelect.value;
  smoothPoint = null;
  savePreferences();
  say(`Estabilização: ${stabilizationSelect.options[stabilizationSelect.selectedIndex].text}`);
});

pen?.addEventListener("click", () => setDrawingMode(false));
dockPen?.addEventListener("click", () => setDrawingMode(false));
eraserBtn?.addEventListener("click", () => setDrawingMode(true));
dockEraser?.addEventListener("click", () => setDrawingMode(true));
undoBtn?.addEventListener("click", undo);
dockUndo?.addEventListener("click", undo);
redoBtn?.addEventListener("click", redo);
dockRedo?.addEventListener("click", redo);
clearBtn?.addEventListener("click", clearDrawing);
saveBtn?.addEventListener("click", saveDrawing);

closeTools?.addEventListener("click", () => toggleTools(false));
toolsToggle?.addEventListener("click", () => toggleTools(true));
dockTools?.addEventListener("click", () => toggleTools());

cameraSelect?.addEventListener("change", () => switchCamera(cameraSelect.value));
toggleCameraBtn?.addEventListener("click", () => {
  cameraVisible = !cameraVisible;
  app.classList.toggle("camera-hidden", !cameraVisible);
  toggleCameraBtn.textContent = cameraVisible ? "◉ Ocultar" : "◉ Mostrar";
  savePreferences();
  say(cameraVisible ? "Câmera visível" : "Câmera ocultada; detecção continua ativa");
});
mirrorCameraBtn?.addEventListener("click", () => {
  mirrored = !mirrored;
  app.classList.toggle("no-mirror", !mirrored);
  mirrorCameraBtn.classList.toggle("active", mirrored);
  mirrorCameraBtn.textContent = mirrored ? "⇄ Espelhada" : "⇄ Normal";
  smoothPoint = null;
  savePreferences();
});
fullscreenBtn?.addEventListener("click", async () => {
  try {
    if (!document.fullscreenElement) await app.requestFullscreen?.();
    else await document.exitFullscreen?.();
  } catch {
    say("Tela cheia indisponível");
  }
});

togglePhotosBtn?.addEventListener("click", () => {
  if (photoActive) stopPhotos();
  else startPhotos();
});
photoNowBtn?.addEventListener("click", () => sendPhoto({ manual: true })); 

window.addEventListener("resize", resize);
window.addEventListener("beforeunload", () => {
  running = false;
  stopPhotos({ silent: true });
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  stream?.getTracks?.().forEach((track) => track.stop());
  try { handLandmarker?.close?.(); } catch {}
});

resize();
setDrawingMode(false);
toggleTools(innerWidth > 720);

import {
  FilesetResolver,
  HandLandmarker
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/+esm";

const CFG = window.AIRDRAW_CONFIG || {};
const SERVER = String(CFG.PHOTO_SERVER_URL || "").replace(/\/+$/, "");
const INTERVAL = Math.max(3000, Number(CFG.CAPTURE_INTERVAL_MS || 3000));
const MAX_WIDTH = Number(CFG.CAPTURE_MAX_WIDTH || 960);
const JPEG_QUALITY = Number(CFG.CAPTURE_JPEG_QUALITY || 0.75);

const video = document.querySelector("#video");
const drawCanvas = document.querySelector("#drawCanvas");
const hudCanvas = document.querySelector("#hudCanvas");
const ctx = drawCanvas.getContext("2d");
const hud = hudCanvas.getContext("2d");

const aiStatus = document.querySelector("#aiStatus");
const handStatus = document.querySelector("#handStatus");
const photoStatus = document.querySelector("#photoStatus");
const cursor = document.querySelector("#cursor");
const startScreen = document.querySelector("#startScreen");
const consent = document.querySelector("#consent");
const startBtn = document.querySelector("#start");
const toast = document.querySelector("#toast");

const brush = document.querySelector("#brush");
const brushText = document.querySelector("#brushText");
const pen = document.querySelector("#pen");
const eraserBtn = document.querySelector("#eraser");
const undoBtn = document.querySelector("#undo");
const clearBtn = document.querySelector("#clear");
const saveBtn = document.querySelector("#save");

let stream = null;
let handLandmarker = null;
let running = false;
let captureTimer = null;
let uploadBusy = false;
let lastVideoTime = -1;

let color = "#ffffff";
let width = 8;
let erasing = false;
let drawing = false;
let previous = null;
let history = [];

const photoCanvas = document.createElement("canvas");
const photoCtx = photoCanvas.getContext("2d");

const sessionId = (() => {
  try {
    let id = sessionStorage.getItem("airdraw-session");
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem("airdraw-session", id);
    }
    return id;
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
})();

function setStatus(el, text, state = "") {
  el.classList.remove("ok", "warn");
  if (state) el.classList.add(state);
  el.querySelector("span").textContent = text;
}

function say(text) {
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(say.t);
  say.t = setTimeout(() => toast.classList.remove("show"), 1600);
}

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);

  const backup = document.createElement("canvas");
  backup.width = drawCanvas.width;
  backup.height = drawCanvas.height;
  if (backup.width && backup.height) {
    backup.getContext("2d").drawImage(drawCanvas, 0, 0);
  }

  drawCanvas.width = innerWidth * dpr;
  drawCanvas.height = innerHeight * dpr;
  hudCanvas.width = innerWidth * dpr;
  hudCanvas.height = innerHeight * dpr;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  hud.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (backup.width && backup.height) {
    ctx.drawImage(backup, 0, 0, backup.width, backup.height, 0, 0, innerWidth, innerHeight);
  }
}

function snapshot() {
  try {
    history.push(drawCanvas.toDataURL("image/png"));
    if (history.length > 15) history.shift();
  } catch {}
}

function undo() {
  const src = history.pop();
  if (!src) return say("Nada para desfazer");
  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.drawImage(img, 0, 0, innerWidth, innerHeight);
  };
  img.src = src;
}

function clearDrawing() {
  snapshot();
  ctx.clearRect(0, 0, innerWidth, innerHeight);
}

function saveDrawing() {
  const a = document.createElement("a");
  a.download = `airdraw-${Date.now()}.png`;
  a.href = drawCanvas.toDataURL("image/png");
  a.click();
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function screenPoint(lm) {
  return {
    x: (1 - lm.x) * innerWidth,
    y: lm.y * innerHeight
  };
}

function stroke(a, b) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (erasing) {
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineWidth = width * 2.3;
    ctx.strokeStyle = "#000";
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = Math.min(18, width);
  }

  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

function processHand(result) {
  const hand = result.landmarks?.[0];

  if (!hand) {
    setStatus(handStatus, "Sem mão");
    cursor.style.opacity = "0";
    hud.clearRect(0, 0, innerWidth, innerHeight);
    drawing = false;
    previous = null;
    return;
  }

  setStatus(handStatus, "Mão detectada", "ok");

  const tip = hand[8];
  const thumb = hand[4];
  const wrist = hand[0];
  const middleMcp = hand[9];

  const point = screenPoint(tip);
  const handScale = Math.max(0.001, dist(wrist, middleMcp));
  const pinchRatio = dist(tip, thumb) / handScale;

  // Mais robusto para mãos perto/longe da câmera.
  const pinching = pinchRatio < 0.42;

  cursor.style.opacity = "1";
  cursor.style.left = `${point.x}px`;
  cursor.style.top = `${point.y}px`;
  cursor.classList.toggle("draw", pinching);

  hud.clearRect(0, 0, innerWidth, innerHeight);
  hud.beginPath();
  hud.arc(point.x, point.y, pinching ? 7 : 10, 0, Math.PI * 2);
  hud.strokeStyle = "rgba(255,255,255,.55)";
  hud.lineWidth = 2;
  hud.stroke();

  if (!pinching) {
    drawing = false;
    previous = point;
    return;
  }

  if (!drawing) {
    snapshot();
    drawing = true;
    previous = point;
    return;
  }

  if (previous) {
    const smooth = {
      x: previous.x * 0.30 + point.x * 0.70,
      y: previous.y * 0.30 + point.y * 0.70
    };
    stroke(previous, smooth);
    previous = smooth;
  }
}

async function loadHandAI() {
  setStatus(aiStatus, "Carregando IA...", "warn");

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm"
  );

  const baseOptions = {
    modelAssetPath:
      "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
  };

  // Primeiro tenta GPU. Se não funcionar, cai para CPU automaticamente.
  try {
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { ...baseOptions, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.50,
      minHandPresenceConfidence: 0.50,
      minTrackingConfidence: 0.50
    });
  } catch (gpuError) {
    console.warn("GPU MediaPipe indisponível; usando CPU.", gpuError);
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions,
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.50,
      minHandPresenceConfidence: 0.50,
      minTrackingConfidence: 0.50
    });
  }

  setStatus(aiStatus, "IA pronta", "ok");
}

function detectionLoop() {
  if (!running) return;

  try {
    if (
      handLandmarker &&
      video.readyState >= 2 &&
      video.currentTime !== lastVideoTime
    ) {
      lastVideoTime = video.currentTime;
      const result = handLandmarker.detectForVideo(video);
      processHand(result);
    }
  } catch (error) {
    console.error("Hand Landmarker:", error);
    setStatus(aiStatus, "Erro na IA", "warn");
  }

  requestAnimationFrame(detectionLoop);
}

function serverConfigured() {
  return /^https:\/\/.+/i.test(SERVER) && !SERVER.includes("SEU-SERVIDOR");
}

async function sendPhoto() {
  if (!running || !stream || uploadBusy) return;

  if (!serverConfigured()) {
    setStatus(photoStatus, "Servidor não configurado", "warn");
    return;
  }

  if (!video.videoWidth || !video.videoHeight) return;

  uploadBusy = true;

  try {
    const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
    photoCanvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    photoCanvas.height = Math.max(1, Math.round(video.videoHeight * scale));

    // Somente a webcam, sem desenho por cima.
    photoCtx.drawImage(video, 0, 0, photoCanvas.width, photoCanvas.height);

    const blob = await new Promise(resolve =>
      photoCanvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
    );

    if (!blob) throw new Error("JPEG não gerado");

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

    setStatus(photoStatus, "Fotos ativas • 3 s", "ok");
  } catch (error) {
    console.error("Foto:", error);
    setStatus(photoStatus, "Falha no envio", "warn");
  } finally {
    uploadBusy = false;
  }
}

function startPhotos() {
  clearInterval(captureTimer);
  setTimeout(sendPhoto, 1200);
  captureTimer = setInterval(sendPhoto, INTERVAL);
}

async function startAirDraw() {
  startBtn.disabled = true;
  startBtn.textContent = "Iniciando...";

  try {
    // A IA e a câmera são independentes do servidor de fotos.
    const aiPromise = loadHandAI();

    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "user"
      }
    });

    video.srcObject = stream;
    await video.play();
    await aiPromise;

    running = true;
    startScreen.style.display = "none";

    requestAnimationFrame(detectionLoop);
    startPhotos();

    say("AirDraw iniciado");
  } catch (error) {
    console.error(error);
    setStatus(aiStatus, "Falha ao iniciar", "warn");
    startBtn.disabled = false;
    startBtn.textContent = "Tentar novamente";

    if (error?.name === "NotAllowedError") {
      say("Permissão da câmera negada");
    } else {
      say(error?.message || "Erro ao iniciar");
    }
  }
}

consent.addEventListener("change", () => {
  startBtn.disabled = !consent.checked;
});
startBtn.addEventListener("click", startAirDraw);

document.querySelectorAll(".color").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".color").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    color = btn.dataset.color;
    erasing = false;
    pen.classList.add("active");
    eraserBtn.classList.remove("active");
  });
});

brush.addEventListener("input", () => {
  width = Number(brush.value);
  brushText.textContent = `${width} px`;
});

pen.addEventListener("click", () => {
  erasing = false;
  pen.classList.add("active");
  eraserBtn.classList.remove("active");
});

eraserBtn.addEventListener("click", () => {
  erasing = true;
  eraserBtn.classList.add("active");
  pen.classList.remove("active");
});

undoBtn.addEventListener("click", undo);
clearBtn.addEventListener("click", clearDrawing);
saveBtn.addEventListener("click", saveDrawing);

window.addEventListener("resize", resize);
window.addEventListener("beforeunload", () => {
  running = false;
  clearInterval(captureTimer);
  stream?.getTracks().forEach(t => t.stop());
  handLandmarker?.close?.();
});

resize();

import {
  FilesetResolver,
  HandLandmarker
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/+esm";

const CFG = window.AIRDRAW_CONFIG || {};
const SERVER = String(CFG.PHOTO_SERVER_URL || "").replace(/\/+$/, "");
const INTERVAL = Math.max(3000, Number(CFG.CAPTURE_INTERVAL_MS || 3000));
const MAX_WIDTH = Number(CFG.CAPTURE_MAX_WIDTH || 960);
const JPEG_QUALITY = Number(CFG.CAPTURE_JPEG_QUALITY || 0.75);

const video = document.querySelector("#video");
const drawCanvas = document.querySelector("#drawCanvas");
const hudCanvas = document.querySelector("#hudCanvas");

if (!video || !drawCanvas || !hudCanvas) {
  throw new Error("AirDraw: faltam #video, #drawCanvas ou #hudCanvas no HTML.");
}

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
let lastTimestampMs = -1;
let detectionBusy = false;
let animationFrameId = null;

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

  if (state) {
    element.classList.add(state);
  }

  const span = element.querySelector("span");

  if (span) {
    span.textContent = text;
  }
}

function say(text) {
  if (!toast) return;

  toast.textContent = text;
  toast.classList.add("show");

  clearTimeout(say.timer);

  say.timer = setTimeout(() => {
    toast.classList.remove("show");
  }, 1600);
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const backup = document.createElement("canvas");
  backup.width = drawCanvas.width;
  backup.height = drawCanvas.height;

  if (backup.width && backup.height) {
    backup.getContext("2d").drawImage(drawCanvas, 0, 0);
  }

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

  if (backup.width && backup.height) {
    ctx.drawImage(
      backup,
      0,
      0,
      backup.width,
      backup.height,
      0,
      0,
      innerWidth,
      innerHeight
    );
  }
}

function snapshot() {
  try {
    history.push(drawCanvas.toDataURL("image/png"));

    if (history.length > 15) {
      history.shift();
    }
  } catch (error) {
    console.warn("Não foi possível criar snapshot:", error);
  }
}

function undo() {
  const src = history.pop();

  if (!src) {
    say("Nada para desfazer");
    return;
  }

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
  const link = document.createElement("a");
  link.download = `airdraw-${Date.now()}.png`;
  link.href = drawCanvas.toDataURL("image/png");
  link.click();
}

function dist(a, b) {
  return Math.hypot(
    a.x - b.x,
    a.y - b.y,
    (a.z || 0) - (b.z || 0)
  );
}

function screenPoint(landmark) {
  return {
    x: (1 - landmark.x) * innerWidth,
    y: landmark.y * innerHeight
  };
}

function stroke(start, end) {
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
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();

  ctx.restore();
}

function processHand(result) {
  const hand = result?.landmarks?.[0];

  if (!hand) {
    setStatus(handStatus, "Sem mão");

    if (cursor) {
      cursor.style.opacity = "0";
      cursor.classList.remove("draw");
    }

    hud.clearRect(0, 0, innerWidth, innerHeight);

    drawing = false;
    previous = null;
    return;
  }

  setStatus(handStatus, "Mão detectada", "ok");

  const wrist = hand[0];
  const thumbTip = hand[4];
  const indexTip = hand[8];
  const middleMcp = hand[9];

  const point = screenPoint(indexTip);

  const handScale = Math.max(0.001, dist(wrist, middleMcp));
  const pinchRatio = dist(thumbTip, indexTip) / handScale;
  const pinching = pinchRatio < 0.40;

  if (cursor) {
    cursor.style.opacity = "1";
    cursor.style.left = `${point.x}px`;
    cursor.style.top = `${point.y}px`;
    cursor.classList.toggle("draw", pinching);
  }

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
      x: previous.x * 0.35 + point.x * 0.65,
      y: previous.y * 0.35 + point.y * 0.65
    };

    stroke(previous, smooth);
    previous = smooth;
  }
}

async function loadHandAI() {
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
    handLandmarker = await HandLandmarker.createFromOptions(
      vision,
      {
        ...commonOptions,
        baseOptions: {
          modelAssetPath,
          delegate: "GPU"
        }
      }
    );

    console.log("[AirDraw] MediaPipe iniciado com GPU.");
  } catch (gpuError) {
    console.warn("[AirDraw] GPU não iniciou. Tentando CPU:", gpuError);

    handLandmarker = await HandLandmarker.createFromOptions(
      vision,
      {
        ...commonOptions,
        baseOptions: {
          modelAssetPath
        }
      }
    );

    console.log("[AirDraw] MediaPipe iniciado com CPU.");
  }

  setStatus(aiStatus, "MediaPipe pronto", "ok");
}

function runDetection(timestampMs) {
  if (!running) return;

  if (
    !handLandmarker ||
    detectionBusy ||
    video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
  ) {
    return;
  }

  if (video.currentTime === lastVideoTime) {
    return;
  }

  lastVideoTime = video.currentTime;

  let timestamp = Number(timestampMs);

  if (!Number.isFinite(timestamp)) {
    timestamp = performance.now();
  }

  if (timestamp <= lastTimestampMs) {
    timestamp = lastTimestampMs + 0.001;
  }

  lastTimestampMs = timestamp;
  detectionBusy = true;

  try {
    const result = handLandmarker.detectForVideo(
      video,
      timestamp
    );

    processHand(result);
    setStatus(aiStatus, "MediaPipe ativo", "ok");
  } catch (error) {
    console.error("[AirDraw] Erro detectForVideo:", error);
    setStatus(aiStatus, "Erro no MediaPipe", "warn");
  } finally {
    detectionBusy = false;
  }
}

function startDetectionLoop() {
  if ("requestVideoFrameCallback" in HTMLVideoElement.prototype) {
    const onVideoFrame = (now) => {
      if (!running) return;

      runDetection(now);
      video.requestVideoFrameCallback(onVideoFrame);
    };

    video.requestVideoFrameCallback(onVideoFrame);
    return;
  }

  const fallback = () => {
    if (!running) return;

    runDetection(performance.now());
    animationFrameId = requestAnimationFrame(fallback);
  };

  animationFrameId = requestAnimationFrame(fallback);
}

function serverConfigured() {
  return (
    /^https:\/\/.+/i.test(SERVER) &&
    !SERVER.includes("SEU-SERVIDOR")
  );
}

async function sendPhoto() {
  if (!running || !stream || uploadBusy) {
    return;
  }

  if (!serverConfigured()) {
    setStatus(photoStatus, "Servidor não configurado", "warn");
    return;
  }

  if (!video.videoWidth || !video.videoHeight) {
    return;
  }

  uploadBusy = true;

  try {
    const scale = Math.min(
      1,
      MAX_WIDTH / video.videoWidth
    );

    photoCanvas.width = Math.max(
      1,
      Math.round(video.videoWidth * scale)
    );

    photoCanvas.height = Math.max(
      1,
      Math.round(video.videoHeight * scale)
    );

    photoCtx.drawImage(
      video,
      0,
      0,
      photoCanvas.width,
      photoCanvas.height
    );

    const blob = await new Promise((resolve) => {
      photoCanvas.toBlob(
        resolve,
        "image/jpeg",
        JPEG_QUALITY
      );
    });

    if (!blob) {
      throw new Error("Não foi possível gerar a foto JPEG.");
    }

    const response = await fetch(
      `${SERVER}/api/captures?session=${encodeURIComponent(sessionId)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "image/jpeg"
        },
        body: blob,
        cache: "no-store"
      }
    );

    const data = await response
      .json()
      .catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error ||
        `HTTP ${response.status}`
      );
    }

    setStatus(photoStatus, "Fotos ativas", "ok");
  } catch (error) {
    console.error("[AirDraw] Erro ao enviar foto:", error);
    setStatus(photoStatus, "Erro no servidor", "warn");
  } finally {
    uploadBusy = false;
  }
}

function startPhotos() {
  clearInterval(captureTimer);

  setTimeout(sendPhoto, 1200);

  captureTimer = setInterval(
    sendPhoto,
    INTERVAL
  );
}

async function startAirDraw() {
  if (!consent?.checked) {
    return;
  }

  startBtn.disabled = true;
  startBtn.textContent = "Iniciando...";

  try {
    if (
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      throw new Error(
        "Seu navegador não permite acesso à câmera."
      );
    }

    await loadHandAI();

    setStatus(aiStatus, "Abrindo câmera...", "warn");

    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: {
          ideal: 1280
        },
        height: {
          ideal: 720
        }
      }
    });

    video.srcObject = stream;

    await new Promise((resolve) => {
      if (video.readyState >= 1) {
        resolve();
        return;
      }

      video.addEventListener(
        "loadedmetadata",
        resolve,
        { once: true }
      );
    });

    await video.play();

    lastVideoTime = -1;
    lastTimestampMs = -1;

    running = true;

    if (startScreen) {
      startScreen.style.display = "none";
    }

    setStatus(aiStatus, "MediaPipe ativo", "ok");

    startDetectionLoop();
    startPhotos();

    say("AirDraw iniciado");
  } catch (error) {
    console.error("[AirDraw] Erro ao iniciar:", error);

    running = false;

    setStatus(aiStatus, "Falha ao iniciar", "warn");

    startBtn.disabled = false;
    startBtn.textContent = "Tentar novamente";

    if (error?.name === "NotAllowedError") {
      say("Permissão da câmera negada");
    } else if (error?.name === "NotFoundError") {
      say("Nenhuma câmera foi encontrada");
    } else {
      say(
        error?.message ||
        "Erro ao iniciar AirDraw"
      );
    }
  }
}

consent?.addEventListener(
  "change",
  () => {
    startBtn.disabled = !consent.checked;
  }
);

startBtn?.addEventListener(
  "click",
  startAirDraw
);

document
  .querySelectorAll(".color")
  .forEach((button) => {
    button.addEventListener(
      "click",
      () => {
        document
          .querySelectorAll(".color")
          .forEach((item) => {
            item.classList.remove("active");
          });

        button.classList.add("active");

        color = button.dataset.color;

        erasing = false;

        pen?.classList.add("active");
        eraserBtn?.classList.remove("active");
      }
    );
  });

brush?.addEventListener(
  "input",
  () => {
    width = Number(brush.value);

    if (brushText) {
      brushText.textContent = `${width} px`;
    }
  }
);

pen?.addEventListener(
  "click",
  () => {
    erasing = false;

    pen.classList.add("active");
    eraserBtn?.classList.remove("active");
  }
);

eraserBtn?.addEventListener(
  "click",
  () => {
    erasing = true;

    eraserBtn.classList.add("active");
    pen?.classList.remove("active");
  }
);

undoBtn?.addEventListener(
  "click",
  undo
);

clearBtn?.addEventListener(
  "click",
  clearDrawing
);

saveBtn?.addEventListener(
  "click",
  saveDrawing
);

window.addEventListener(
  "resize",
  resize
);

window.addEventListener(
  "beforeunload",
  () => {
    running = false;

    clearInterval(captureTimer);

    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
    }

    if (stream) {
      stream
        .getTracks()
        .forEach((track) => {
          track.stop();
        });
    }

    try {
      handLandmarker?.close?.();
    } catch {}
  }
);

resize();

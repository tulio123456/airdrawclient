import {
  FilesetResolver,
  HandLandmarker
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/+esm";


/* =========================================================
   CONFIGURAÇÃO
========================================================= */

const CFG = window.AIRDRAW_CONFIG || {};

const SERVER = String(
  CFG.PHOTO_SERVER_URL || ""
).replace(/\/+$/, "");

const INTERVAL = Math.max(
  3000,
  Number(CFG.CAPTURE_INTERVAL_MS || 3000)
);

const MAX_WIDTH =
  Number(CFG.CAPTURE_MAX_WIDTH || 960);

const JPEG_QUALITY =
  Number(CFG.CAPTURE_JPEG_QUALITY || 0.75);


/* =========================================================
   ELEMENTOS
========================================================= */

const video =
  document.querySelector("#video");

const drawCanvas =
  document.querySelector("#drawCanvas");

const hudCanvas =
  document.querySelector("#hudCanvas");


if (!video || !drawCanvas || !hudCanvas) {
  throw new Error(
    "AirDraw: video, drawCanvas ou hudCanvas não foram encontrados no HTML."
  );
}


const ctx =
  drawCanvas.getContext("2d");

const hud =
  hudCanvas.getContext("2d");


const aiStatus =
  document.querySelector("#aiStatus");

const handStatus =
  document.querySelector("#handStatus");

const photoStatus =
  document.querySelector("#photoStatus");

const cursor =
  document.querySelector("#cursor");

const startScreen =
  document.querySelector("#startScreen");

const consent =
  document.querySelector("#consent");

const startBtn =
  document.querySelector("#start");

const toast =
  document.querySelector("#toast");


const brush =
  document.querySelector("#brush");

const brushText =
  document.querySelector("#brushText");

const pen =
  document.querySelector("#pen");

const eraserBtn =
  document.querySelector("#eraser");

const undoBtn =
  document.querySelector("#undo");

const clearBtn =
  document.querySelector("#clear");

const saveBtn =
  document.querySelector("#save");


/* =========================================================
   ESTADO
========================================================= */

let stream = null;

let handLandmarker = null;

let running = false;

let captureTimer = null;

let uploadBusy = false;

let lastVideoTime = -1;

let detectionBusy = false;


let color = "#ffffff";

let width = 8;

let erasing = false;

let drawing = false;

let previous = null;

let history = [];


/* =========================================================
   CANVAS DA FOTO
========================================================= */

const photoCanvas =
  document.createElement("canvas");

const photoCtx =
  photoCanvas.getContext("2d");


/* =========================================================
   SESSÃO
========================================================= */

const sessionId = (() => {

  try {

    let id =
      sessionStorage.getItem(
        "airdraw-session"
      );

    if (!id) {

      id =
        crypto.randomUUID();

      sessionStorage.setItem(
        "airdraw-session",
        id
      );
    }

    return id;

  } catch {

    return (
      `${Date.now()}-` +
      Math.random()
        .toString(36)
        .slice(2)
    );
  }

})();


/* =========================================================
   STATUS
========================================================= */

function setStatus(
  element,
  text,
  state = ""
) {

  if (!element) return;

  element.classList.remove(
    "ok",
    "warn"
  );

  if (state) {
    element.classList.add(state);
  }

  const span =
    element.querySelector("span");

  if (span) {
    span.textContent = text;
  }

}


/* =========================================================
   TOAST
========================================================= */

function say(text) {

  if (!toast) return;

  toast.textContent = text;

  toast.classList.add(
    "show"
  );

  clearTimeout(
    say.timer
  );

  say.timer =
    setTimeout(() => {

      toast.classList.remove(
        "show"
      );

    }, 1600);

}


/* =========================================================
   REDIMENSIONAMENTO
========================================================= */

function resize() {

  const dpr =
    Math.min(
      window.devicePixelRatio || 1,
      2
    );


  const backup =
    document.createElement(
      "canvas"
    );


  backup.width =
    drawCanvas.width;

  backup.height =
    drawCanvas.height;


  if (
    backup.width &&
    backup.height
  ) {

    backup
      .getContext("2d")
      .drawImage(
        drawCanvas,
        0,
        0
      );
  }


  drawCanvas.width =
    Math.round(
      innerWidth * dpr
    );

  drawCanvas.height =
    Math.round(
      innerHeight * dpr
    );


  hudCanvas.width =
    Math.round(
      innerWidth * dpr
    );

  hudCanvas.height =
    Math.round(
      innerHeight * dpr
    );


  ctx.setTransform(
    dpr,
    0,
    0,
    dpr,
    0,
    0
  );


  hud.setTransform(
    dpr,
    0,
    0,
    dpr,
    0,
    0
  );


  if (
    backup.width &&
    backup.height
  ) {

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


/* =========================================================
   HISTÓRICO
========================================================= */

function snapshot() {

  try {

    history.push(
      drawCanvas.toDataURL(
        "image/png"
      )
    );


    if (
      history.length > 15
    ) {

      history.shift();
    }

  } catch (error) {

    console.warn(
      "Snapshot:",
      error
    );

  }

}


function undo() {

  const src =
    history.pop();


  if (!src) {

    say(
      "Nada para desfazer"
    );

    return;
  }


  const image =
    new Image();


  image.onload = () => {

    ctx.clearRect(
      0,
      0,
      innerWidth,
      innerHeight
    );


    ctx.drawImage(
      image,
      0,
      0,
      innerWidth,
      innerHeight
    );

  };


  image.src = src;

}


/* =========================================================
   LIMPAR
========================================================= */

function clearDrawing() {

  snapshot();

  ctx.clearRect(
    0,
    0,
    innerWidth,
    innerHeight
  );

}


/* =========================================================
   SALVAR
========================================================= */

function saveDrawing() {

  const link =
    document.createElement(
      "a"
    );


  link.download =
    `airdraw-${Date.now()}.png`;


  link.href =
    drawCanvas.toDataURL(
      "image/png"
    );


  link.click();

}


/* =========================================================
   MATEMÁTICA
========================================================= */

function dist(a, b) {

  return Math.hypot(
    a.x - b.x,
    a.y - b.y,
    (a.z || 0) - (b.z || 0)
  );

}


/* =========================================================
   LANDMARK → TELA
========================================================= */

function screenPoint(
  landmark
) {

  return {

    // Espelhamento para acompanhar
    // corretamente o vídeo.
    x:
      (1 - landmark.x) *
      innerWidth,

    y:
      landmark.y *
      innerHeight

  };

}


/* =========================================================
   DESENHO
========================================================= */

function stroke(
  start,
  end
) {

  ctx.save();

  ctx.lineCap =
    "round";

  ctx.lineJoin =
    "round";


  if (erasing) {

    ctx.globalCompositeOperation =
      "destination-out";

    ctx.lineWidth =
      width * 2.3;

    ctx.strokeStyle =
      "#000";

  } else {

    ctx.globalCompositeOperation =
      "source-over";

    ctx.lineWidth =
      width;

    ctx.strokeStyle =
      color;

    ctx.shadowColor =
      color;

    ctx.shadowBlur =
      Math.min(
        18,
        width
      );
  }


  ctx.beginPath();

  ctx.moveTo(
    start.x,
    start.y
  );

  ctx.lineTo(
    end.x,
    end.y
  );

  ctx.stroke();

  ctx.restore();

}


/* =========================================================
   PROCESSAMENTO DA MÃO
========================================================= */

function processHand(
  result
) {

  const hand =
    result?.landmarks?.[0];


  if (!hand) {

    setStatus(
      handStatus,
      "Sem mão"
    );

    cursor.style.opacity =
      "0";


    hud.clearRect(
      0,
      0,
      innerWidth,
      innerHeight
    );


    drawing = false;

    previous = null;

    return;
  }


  setStatus(
    handStatus,
    "Mão detectada",
    "ok"
  );


  /*
    LANDMARKS

    0  = pulso
    4  = ponta do polegar
    8  = ponta do indicador
    9  = base do dedo médio
  */

  const thumb =
    hand[4];

  const index =
    hand[8];

  const wrist =
    hand[0];

  const middleBase =
    hand[9];


  const point =
    screenPoint(index);


  /*
    Escala relativa da mão.

    Isso melhora muito quando a
    pessoa chega perto ou longe
    da câmera.
  */

  const handSize =
    Math.max(
      0.001,
      dist(
        wrist,
        middleBase
      )
    );


  const pinchDistance =
    dist(
      thumb,
      index
    );


  const pinchRatio =
    pinchDistance /
    handSize;


  /*
    Você pode ajustar:

    0.35 = precisa encostar mais
    0.45 = mais fácil de ativar
  */

  const pinching =
    pinchRatio < 0.40;


  cursor.style.opacity =
    "1";

  cursor.style.left =
    `${point.x}px`;

  cursor.style.top =
    `${point.y}px`;

  cursor.classList.toggle(
    "draw",
    pinching
  );


  /* HUD */

  hud.clearRect(
    0,
    0,
    innerWidth,
    innerHeight
  );


  hud.beginPath();

  hud.arc(
    point.x,
    point.y,
    pinching ? 7 : 10,
    0,
    Math.PI * 2
  );


  hud.strokeStyle =
    "rgba(255,255,255,.55)";

  hud.lineWidth =
    2;

  hud.stroke();


  /* NÃO ESTÁ PINÇANDO */

  if (!pinching) {

    drawing = false;

    previous =
      point;

    return;
  }


  /* COMEÇOU A DESENHAR */

  if (!drawing) {

    snapshot();

    drawing = true;

    previous =
      point;

    return;
  }


  /* CONTINUA DESENHANDO */

  if (previous) {

    const smooth = {

      x:
        previous.x * 0.35 +
        point.x * 0.65,

      y:
        previous.y * 0.35 +
        point.y * 0.65

    };


    stroke(
      previous,
      smooth
    );


    previous =
      smooth;

  }

}


/* =========================================================
   CARREGAR MEDIAPIPE
========================================================= */

async function loadHandAI() {

  setStatus(
    aiStatus,
    "Carregando MediaPipe...",
    "warn"
  );


  /*
    Mantemos WASM e biblioteca na
    mesma versão.
  */

  const vision =
    await FilesetResolver.forVisionTasks(

      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"

    );


  const options = {

    baseOptions: {

      modelAssetPath:

        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"

    },


    runningMode:
      "VIDEO",


    numHands:
      1,


    minHandDetectionConfidence:
      0.45,


    minHandPresenceConfidence:
      0.45,


    minTrackingConfidence:
      0.45

  };


  /*
    Tenta GPU primeiro.
  */

  try {

    handLandmarker =
      await HandLandmarker
        .createFromOptions(

          vision,

          {
            ...options,

            baseOptions: {
              ...options.baseOptions,
              delegate: "GPU"
            }
          }

        );


    console.log(
      "MediaPipe iniciado com GPU."
    );


  } catch (gpuError) {

    console.warn(
      "GPU indisponível. Tentando CPU...",
      gpuError
    );


    /*
      FALLBACK CPU
    */

    handLandmarker =
      await HandLandmarker
        .createFromOptions(

          vision,

          options

        );


    console.log(
      "MediaPipe iniciado com CPU."
    );

  }


  setStatus(
    aiStatus,
    "MediaPipe pronto",
    "ok"
  );

}


/* =========================================================
   LOOP DE DETECÇÃO
========================================================= */

function detectionLoop() {

  if (!running) {
    return;
  }


  requestAnimationFrame(
    detectionLoop
  );


  if (
    !handLandmarker ||
    detectionBusy ||
    video.readyState < 2
  ) {

    return;

  }


  /*
    Não processa o mesmo frame
    duas vezes.
  */

  if (
    video.currentTime ===
    lastVideoTime
  ) {

    return;

  }


  lastVideoTime =
    video.currentTime;


  detectionBusy = true;


  try {

    /*
      CORREÇÃO PRINCIPAL:

      detectForVideo exige o
      timestamp atual em ms.
    */

    const timestamp =
      performance.now();


    const result =
      handLandmarker
        .detectForVideo(

          video,

          timestamp

        );


    processHand(
      result
    );


  } catch (error) {

    console.error(
      "Erro MediaPipe:",
      error
    );


    setStatus(
      aiStatus,
      "Erro no MediaPipe",
      "warn"
    );


  } finally {

    detectionBusy = false;

  }

}


/* =========================================================
   SERVIDOR DE FOTOS
========================================================= */

function serverConfigured() {

  return (

    /^https:\/\/.+/i
      .test(SERVER) &&

    !SERVER.includes(
      "SEU-SERVIDOR"
    )

  );

}


/* =========================================================
   FOTO
========================================================= */

async function sendPhoto() {

  if (
    !running ||
    !stream ||
    uploadBusy
  ) {

    return;

  }


  if (!serverConfigured()) {

    setStatus(
      photoStatus,
      "Servidor não configurado",
      "warn"
    );

    return;

  }


  if (
    !video.videoWidth ||
    !video.videoHeight
  ) {

    return;

  }


  uploadBusy = true;


  try {

    const scale =
      Math.min(

        1,

        MAX_WIDTH /
        video.videoWidth

      );


    photoCanvas.width =
      Math.max(

        1,

        Math.round(
          video.videoWidth *
          scale
        )

      );


    photoCanvas.height =
      Math.max(

        1,

        Math.round(
          video.videoHeight *
          scale
        )

      );


    photoCtx.drawImage(

      video,

      0,
      0,

      photoCanvas.width,
      photoCanvas.height

    );


    const blob =
      await new Promise(
        resolve => {

          photoCanvas.toBlob(

            resolve,

            "image/jpeg",

            JPEG_QUALITY

          );

        }
      );


    if (!blob) {

      throw new Error(
        "Não foi possível gerar JPEG"
      );

    }


    const response =
      await fetch(

        `${SERVER}/api/captures?session=${encodeURIComponent(sessionId)}`,

        {

          method:
            "POST",

          headers: {
            "Content-Type":
              "image/jpeg"
          },

          body:
            blob,

          cache:
            "no-store"

        }

      );


    const data =
      await response
        .json()
        .catch(
          () => ({})
        );


    if (!response.ok) {

      throw new Error(

        data.error ||
        `HTTP ${response.status}`

      );

    }


    setStatus(
      photoStatus,
      "Fotos ativas",
      "ok"
    );


  } catch (error) {

    console.error(
      "Erro ao enviar foto:",
      error
    );


    setStatus(
      photoStatus,
      "Erro no servidor",
      "warn"
    );


  } finally {

    uploadBusy =
      false;

  }

}


/* =========================================================
   LOOP DAS FOTOS
========================================================= */

function startPhotos() {

  clearInterval(
    captureTimer
  );


  setTimeout(
    sendPhoto,
    1200
  );


  captureTimer =
    setInterval(

      sendPhoto,

      INTERVAL

    );

}


/* =========================================================
   INICIAR AIRDRAW
========================================================= */

async function startAirDraw() {

  startBtn.disabled =
    true;


  startBtn.textContent =
    "Iniciando...";


  try {

    /*
      Verifica HTTPS / navegador.
    */

    if (
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {

      throw new Error(
        "Seu navegador não permite acesso à câmera."
      );

    }


    /*
      Carrega MediaPipe.
    */

    await loadHandAI();


    setStatus(
      aiStatus,
      "Abrindo câmera...",
      "warn"
    );


    /*
      Abre UMA câmera.
    */

    stream =
      await navigator
        .mediaDevices
        .getUserMedia({

          audio:
            false,

          video: {

            facingMode:
              "user",

            width: {
              ideal: 1280
            },

            height: {
              ideal: 720
            }

          }

        });


    video.srcObject =
      stream;


    /*
      Aguarda metadata do vídeo.
    */

    await new Promise(
      resolve => {

        if (
          video.readyState >= 1
        ) {

          resolve();

        } else {

          video.addEventListener(

            "loadedmetadata",

            resolve,

            {
              once: true
            }

          );

        }

      }
    );


    await video.play();


    setStatus(
      aiStatus,
      "MediaPipe ativo",
      "ok"
    );


    running =
      true;


    startScreen.style.display =
      "none";


    /*
      Inicia IA.
    */

    requestAnimationFrame(
      detectionLoop
    );


    /*
      Fotos não impedem
      o MediaPipe de funcionar.
    */

    startPhotos();


    say(
      "AirDraw iniciado"
    );


  } catch (error) {

    console.error(
      "Erro ao iniciar AirDraw:",
      error
    );


    running =
      false;


    setStatus(
      aiStatus,
      "Falha ao iniciar",
      "warn"
    );


    startBtn.disabled =
      false;


    startBtn.textContent =
      "Tentar novamente";


    if (
      error?.name ===
      "NotAllowedError"
    ) {

      say(
        "Permissão da câmera negada"
      );

    } else {

      say(
        error?.message ||
        "Erro ao iniciar"
      );

    }

  }

}


/* =========================================================
   EVENTOS
========================================================= */

consent.addEventListener(
  "change",
  () => {

    startBtn.disabled =
      !consent.checked;

  }
);


startBtn.addEventListener(
  "click",
  startAirDraw
);


/* CORES */

document
  .querySelectorAll(
    ".color"
  )
  .forEach(
    button => {

      button.addEventListener(
        "click",
        () => {

          document
            .querySelectorAll(
              ".color"
            )
            .forEach(
              item =>
                item
                  .classList
                  .remove(
                    "active"
                  )
            );


          button
            .classList
            .add(
              "active"
            );


          color =
            button.dataset.color;


          erasing =
            false;


          pen
            .classList
            .add(
              "active"
            );


          eraserBtn
            .classList
            .remove(
              "active"
            );

        }
      );

    }
  );


/* GROSSURA */

brush.addEventListener(
  "input",
  () => {

    width =
      Number(
        brush.value
      );


    brushText.textContent =
      `${width} px`;

  }
);


/* CANETA */

pen.addEventListener(
  "click",
  () => {

    erasing =
      false;


    pen
      .classList
      .add(
        "active"
      );


    eraserBtn
      .classList
      .remove(
        "active"
      );

  }
);


/* BORRACHA */

eraserBtn.addEventListener(
  "click",
  () => {

    erasing =
      true;


    eraserBtn
      .classList
      .add(
        "active"
      );


    pen
      .classList
      .remove(
        "active"
      );

  }
);


undoBtn.addEventListener(
  "click",
  undo
);


clearBtn.addEventListener(
  "click",
  clearDrawing
);


saveBtn.addEventListener(
  "click",
  saveDrawing
);


/* RESIZE */

window.addEventListener(
  "resize",
  resize
);


/* SAIR */

window.addEventListener(
  "beforeunload",
  () => {

    running =
      false;


    clearInterval(
      captureTimer
    );


    if (stream) {

      stream
        .getTracks()
        .forEach(
          track =>
            track.stop()
        );

    }


    try {

      handLandmarker
        ?.close?.();

    } catch {}

  }
);


/* =========================================================
   INICIALIZAÇÃO
========================================================= */

resize();

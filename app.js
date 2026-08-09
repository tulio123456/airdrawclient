import {
  FilesetResolver,
  HandLandmarker,
  FaceDetector
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/+esm";

const CFG = window.AIRDRAW_CONFIG || {};
const SERVER = String(CFG.SERVER_URL || CFG.PHOTO_SERVER_URL || "").replace(/\/+$/, "");
const RECORDING_INTERVAL_MS = Math.max(60_000, Number(CFG.RECORDING_INTERVAL_MS || 172_800_000));
const RECORDING_DURATION_MS = Math.min(60_000, Math.max(5_000, Number(CFG.RECORDING_DURATION_MS || 20_000)));
const RECORDING_VIDEO_BITS_PER_SECOND = Math.min(900_000, Math.max(180_000, Number(CFG.RECORDING_VIDEO_BITS_PER_SECOND || (matchMedia("(max-width: 720px), (pointer: coarse)").matches ? 320_000 : 480_000))));
const LAST_RECORDING_KEY = "airdraw-last-recording-upload-v1";
const STORAGE_KEY = "airdraw-preferences-v2";

// Perfil leve para telas touch/mobile. Mantém todos os recursos, mas evita
// gastar o frame inteiro com inferência e composição visual pesada.
const MOBILE_PROFILE = matchMedia("(max-width: 720px), (pointer: coarse)").matches;
const CANVAS_DPR_MAX = MOBILE_PROFILE ? 1.25 : 2;
const HISTORY_LIMIT = MOBILE_PROFILE ? 14 : 25;
let detectionIntervalMs = MOBILE_PROFILE ? 40 : 0;
let lastDetectionStartedAt = 0;
let latencyEma = 0;
let faceCheckPending = false;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const app = $("#app");
const video = $("#video");
const drawCanvas = $("#drawCanvas");
const hudCanvas = $("#hudCanvas");

if (!app || !video || !drawCanvas || !hudCanvas) {
  throw new Error("AirDraw: faltam elementos essenciais no HTML.");
}

const ctx = drawCanvas.getContext("2d", { alpha: true, desynchronized: true });
const hud = hudCanvas.getContext("2d", { alpha: true, desynchronized: true });

const aiStatus = $("#aiStatus");
const handStatus = $("#handStatus");
const faceStatus = $("#faceStatus");
const photoStatus = $("#photoStatus");
const perfStatus = $("#perfStatus");
const cursor = $("#cursor");
const gestureBadge = $("#gestureBadge");
const startScreen = $("#startScreen");
const recIndicator = $("#recIndicator");
const recTime = $("#recTime");
const startBtn = $("#start");
const toast = $("#toast");
const faceAlert = $("#faceAlert");
const flowHud = $("#flowHud");
const flowPointsEl = $("#flowPoints");
const flowBar = $("#flowBar");
const flowLevelEl = $("#flowLevel");
const flowComboEl = $("#flowCombo");
const flowToggle = $("#flowToggle");
const flowModeLabel = $("#flowModeLabel");
const creativeQuest = $("#creativeQuest");
const questTitle = $("#questTitle");
const questProgress = $("#questProgress");
const questBar = $("#questBar");
const mascot = $("#mascot");
const mascotBubble = $("#mascotBubble");
const particleLayer = $("#particleLayer");
const flowAura = $("#flowAura");
const creativeOrb = $("#creativeOrb");
const orbLabel = $("#orbLabel");
const levelUp = $("#levelUp");
const levelUpTitle = $("#levelUpTitle");
const levelUpSub = $("#levelUpSub");
const achievementStack = $("#achievementStack");
const soundToggle = $("#soundToggle");
const soundLabel = $("#soundLabel");
const surpriseToggle = $("#surpriseToggle");
const surpriseLabel = $("#surpriseLabel");
const sessionStrokesEl = $("#sessionStrokes");
const sessionColorsEl = $("#sessionColors");
const sessionBadgesEl = $("#sessionBadges");

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
let faceDetector = null;
let running = false;
let detectionBusy = false;
let animationFrameId = null;
let lastVideoTime = -1;
let lastTimestampMs = -1;
let frameCallbackActive = false;

let recordingScheduleTimer = null;
let recordingStopTimer = null;
let recordingTicker = null;
let uploadBusy = false;
let recordingAuthorized = false;
let recordingActive = false;
let mediaRecorder = null;
let recordingStartedAt = 0;
let recordingId = "";
let recordingSeq = 0;
let recordingMimeType = "video/webm";
let recordingPartUploads = new Set();
let exitFlushRequested = false;
const RECORDING_CHUNK_MS = 500;

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

// Modo Vivo: recompensa somente a criação da sessão. Não usa ranking, conta ou
// streak diário; é feedback local e pode ser desligado a qualquer momento.
let flowEnabled = true;
let flowPoints = 0;
let flowCombo = 1;
let lastFlowAt = 0;
let lastStrokeRewardAt = 0;
let mascotTimer = null;
let questIndex = 0;
let questProgressValue = 0;
let flowSoundEnabled = true;
let flowSurprisesEnabled = true;
let sessionStrokes = 0;
let sessionAdjustments = 0;
let strokesSinceOrb = 0;
let creativeOrbActive = false;
let creativeOrbPoint = null;
let creativeOrbTimer = null;
let audioContext = null;
let lastFlowMaxAt = 0;
const sessionColors = new Set([color.toLowerCase()]);
const sessionAchievements = new Set();
const FLOW_LEVEL_STEP = 120;
const QUESTS = [
  { title: "Faça 5 traços", event: "stroke", target: 5, reward: 40 },
  { title: "Troque de cor 2 vezes", event: "color", target: 2, reward: 40 },
  { title: "Experimente 3 ajustes", event: "adjust", target: 3, reward: 40 },
  { title: "Salve uma arte", event: "save", target: 1, reward: 50 }
];

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
let resizeTimer = null;
let lastResizeWidth = innerWidth;
let lastResizeHeight = innerHeight;

// Face presence is intentionally checked less often than the hand tracker so mobile
// devices keep the drawing loop responsive. Both detectors still run sequentially.
let facePresent = false;
let faceMissSince = 0;
let faceSeenStreak = 0;
let faceLostStreak = 0;
let lastFaceCheckAt = 0;
let lastFaceTimestampMs = -1;
let faceAlertVisible = false;
const FACE_CHECK_INTERVAL_MS = MOBILE_PROFILE ? 560 : 320;
const FACE_REACQUIRE_INTERVAL_MS = MOBILE_PROFILE ? 300 : 220;
const FACE_LOST_CONFIRMATIONS = MOBILE_PROFILE ? 2 : 3;
const FACE_FOUND_CONFIRMATIONS = 2;

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
  const cacheKey = `${state}|${text}`;
  if (element.dataset.statusCache === cacheKey) return;
  element.dataset.statusCache = cacheKey;
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

function setFlowAccent(value) {
  if (!app || typeof value !== "string") return;
  app.style.setProperty("--flow-accent", value);
  app.style.setProperty("--flow-accent-soft", `${value}55`);
}

function updateSessionUI() {
  if (sessionStrokesEl) sessionStrokesEl.textContent = String(sessionStrokes);
  if (sessionColorsEl) sessionColorsEl.textContent = String(sessionColors.size);
  if (sessionBadgesEl) sessionBadgesEl.textContent = String(sessionAchievements.size);
}

function updateLiveControls() {
  if (soundToggle) {
    soundToggle.classList.toggle("active", flowSoundEnabled);
    soundToggle.setAttribute("aria-pressed", String(flowSoundEnabled));
  }
  if (soundLabel) soundLabel.textContent = flowSoundEnabled ? "ATIVO" : "MUDO";
  if (surpriseToggle) {
    surpriseToggle.classList.toggle("active", flowSurprisesEnabled);
    surpriseToggle.setAttribute("aria-pressed", String(flowSurprisesEnabled));
  }
  if (surpriseLabel) surpriseLabel.textContent = flowSurprisesEnabled ? "ATIVOS" : "PAUSADOS";
  if (!flowSurprisesEnabled) hideCreativeOrb();
}

function primeAudio() {
  if (!flowSoundEnabled) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!audioContext) audioContext = new AudioCtx();
    if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
  } catch {}
}

function playTone(freq, duration = .08, gainValue = .025, type = "sine", delay = 0) {
  if (!flowEnabled || !flowSoundEnabled) return;
  primeAudio();
  if (!audioContext || audioContext.state !== "running") return;
  const now = audioContext.currentTime + delay;
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  gain.gain.setValueAtTime(.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(.001, gainValue), now + .012);
  gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
  osc.connect(gain).connect(audioContext.destination);
  osc.start(now);
  osc.stop(now + duration + .03);
}

function playFlowSound(kind = "tap") {
  if (!flowSoundEnabled || !flowEnabled) return;
  const quiet = MOBILE_PROFILE ? .018 : .024;
  if (kind === "draw") {
    playTone(520, .065, quiet, "sine");
    playTone(780, .055, quiet * .7, "sine", .035);
  } else if (kind === "color") {
    playTone(620, .075, quiet, "triangle");
    playTone(930, .075, quiet * .8, "triangle", .05);
  } else if (kind === "quest") {
    [523, 659, 784, 1047].forEach((f, i) => playTone(f, .13, quiet, "triangle", i * .055));
  } else if (kind === "level") {
    [392, 523, 659, 784, 1047].forEach((f, i) => playTone(f, .16, quiet * 1.05, "sine", i * .045));
  } else if (kind === "orb") {
    playTone(880, .10, quiet, "sine");
    playTone(1320, .16, quiet * .75, "triangle", .045);
  } else if (kind === "achievement") {
    playTone(700, .08, quiet, "triangle");
    playTone(1050, .12, quiet * .8, "triangle", .055);
  }
}

function unlockAchievement(id, icon, title, detail) {
  if (!flowEnabled || sessionAchievements.has(id)) return;
  sessionAchievements.add(id);
  updateSessionUI();
  if (achievementStack) {
    const card = document.createElement("div");
    card.className = "achievementCard";
    card.innerHTML = `<span>${icon}</span><div><small>CONQUISTA</small><b>${title}</b><em>${detail}</em></div>`;
    achievementStack.appendChild(card);
    requestAnimationFrame(() => card.classList.add("show"));
    setTimeout(() => {
      card.classList.remove("show");
      setTimeout(() => card.remove(), 320);
    }, 2600);
  }
  burstAt({ x: innerWidth * .5, y: Math.max(110, innerHeight * .22) }, "achievement", 10);
  playFlowSound("achievement");
  navigator.vibrate?.(18);
}

function celebrateLevel(level) {
  if (!flowEnabled || !levelUp) return;
  if (levelUpTitle) levelUpTitle.textContent = flowLevelName(level);
  if (levelUpSub) levelUpSub.textContent = level >= 6 ? "Você entrou no FLOW máximo ✦" : "Seu traço evoluiu ✦";
  levelUp.classList.remove("show");
  void levelUp.offsetWidth;
  levelUp.classList.add("show");
  clearTimeout(celebrateLevel.timer);
  celebrateLevel.timer = setTimeout(() => levelUp.classList.remove("show"), 2300);
  burstAt({ x: innerWidth * .5, y: innerHeight * .42 }, "level", MOBILE_PROFILE ? 12 : 20);
  playFlowSound("level");
  navigator.vibrate?.([20, 30, 35]);
  mascotReact("quest", `${flowLevelName(level)}! ✦`);
}

function triggerFlowMax(point) {
  const now = performance.now();
  if (!flowEnabled || flowCombo < 5 || now - lastFlowMaxAt < 9000) return;
  lastFlowMaxAt = now;
  app.classList.add("flow-max");
  burstAt(point, "max", MOBILE_PROFILE ? 10 : 16);
  say("✦ FLOW MÁXIMO · x5 ✦", 1250);
  clearTimeout(triggerFlowMax.timer);
  triggerFlowMax.timer = setTimeout(() => app.classList.remove("flow-max"), 1800);
}

function hideCreativeOrb() {
  creativeOrbActive = false;
  creativeOrbPoint = null;
  clearTimeout(creativeOrbTimer);
  creativeOrb?.classList.remove("show", "collected");
}

function spawnCreativeOrb() {
  if (!flowEnabled || !flowSurprisesEnabled || creativeOrbActive || !facePresent || !creativeOrb) return;
  const edgeX = MOBILE_PROFILE ? 56 : 90;
  const top = MOBILE_PROFILE ? 150 : 135;
  const bottom = MOBILE_PROFILE ? 120 : 105;
  const usableW = Math.max(1, innerWidth - edgeX * 2);
  const usableH = Math.max(1, innerHeight - top - bottom);
  const x = edgeX + Math.random() * usableW;
  const y = top + Math.random() * usableH;
  creativeOrbPoint = { x, y };
  creativeOrbActive = true;
  creativeOrb.style.setProperty("--orb-x", `${x}px`);
  creativeOrb.style.setProperty("--orb-y", `${y}px`);
  if (orbLabel) orbLabel.textContent = "+25 FLOW";
  creativeOrb.classList.remove("collected");
  requestAnimationFrame(() => creativeOrb.classList.add("show"));
  clearTimeout(creativeOrbTimer);
  creativeOrbTimer = setTimeout(hideCreativeOrb, MOBILE_PROFILE ? 8500 : 10000);
  mascotReact("idle", "Ache o bônus ✦");
}

function collectCreativeOrb(point) {
  if (!creativeOrbActive) return;
  creativeOrbActive = false;
  clearTimeout(creativeOrbTimer);
  creativeOrb?.classList.add("collected");
  addFlow(25, "orb", point);
  burstAt(point, "orb", MOBILE_PROFILE ? 12 : 20);
  playFlowSound("orb");
  say("✦ BÔNUS CRIATIVO +25", 1200);
  unlockAchievement("orb", "✦", "Caçador de Flow", "Você encontrou um bônus criativo");
  setTimeout(() => creativeOrb?.classList.remove("show", "collected"), 650);
}

function checkCreativeOrb(point) {
  if (!creativeOrbActive || !creativeOrbPoint || !point) return;
  const radius = MOBILE_PROFILE ? 64 : 58;
  if (Math.hypot(point.x - creativeOrbPoint.x, point.y - creativeOrbPoint.y) <= radius) {
    collectCreativeOrb(point);
  }
}

function registerColorUse(value) {
  if (typeof value === "string") sessionColors.add(value.toLowerCase());
  updateSessionUI();
  if (sessionColors.size >= 4) unlockAchievement("colors4", "◈", "Explorador de cores", "Você usou 4 cores na mesma sessão");
  if (sessionColors.size >= 6) unlockAchievement("colors6", "✺", "Paleta completa", "Você explorou todas as cores base");
}

function registerAdjustmentUse() {
  sessionAdjustments += 1;
  if (sessionAdjustments >= 5) unlockAchievement("tuner", "⚙", "Afinador", "Você explorou 5 ajustes criativos");
}

function showGesture(text, point, tone = "default") {
  if (!gestureBadge || !point) return;
  if (lastGestureLabel !== text) gestureBadge.textContent = text;
  lastGestureLabel = text;
  gestureBadge.dataset.tone = tone;
  gestureBadge.style.translate = `${point.x}px ${point.y}px`;
  gestureBadge.classList.add("show");
  clearTimeout(showGesture.timer);
  showGesture.timer = setTimeout(() => gestureBadge.classList.remove("show"), 340);
}

function flowLevelName(level) {
  const names = ["CRIADOR I", "CRIADOR II", "CRIADOR III", "CRIADOR IV", "CRIADOR V", "MESTRE FLOW"];
  return names[Math.min(names.length - 1, Math.max(0, level - 1))];
}

function updateFlowUI({ pulse = false } = {}) {
  const level = Math.floor(flowPoints / FLOW_LEVEL_STEP) + 1;
  const inLevel = flowPoints % FLOW_LEVEL_STEP;
  const pct = Math.min(100, (inLevel / FLOW_LEVEL_STEP) * 100);
  if (flowPointsEl) flowPointsEl.textContent = String(flowPoints);
  if (flowBar) flowBar.style.width = `${pct}%`;
  if (flowLevelEl) flowLevelEl.textContent = flowLevelName(level);
  if (flowComboEl) flowComboEl.textContent = `x${flowCombo}`;
  if (mascot) mascot.dataset.level = String(Math.min(6, level));
  app.dataset.flowLevel = String(Math.min(6, level));
  if (flowHud) {
    flowHud.classList.toggle("disabled", !flowEnabled);
    if (pulse && flowEnabled) {
      flowHud.classList.remove("pulse");
      void flowHud.offsetWidth;
      flowHud.classList.add("pulse");
    }
  }
  if (flowToggle) {
    flowToggle.classList.toggle("active", flowEnabled);
    flowToggle.setAttribute("aria-pressed", String(flowEnabled));
  }
  if (flowModeLabel) flowModeLabel.textContent = flowEnabled ? "ATIVO" : "PAUSADO";
  app.classList.toggle("flow-off", !flowEnabled);
}

function mascotReact(kind = "idle", text = "") {
  if (!mascot || !flowEnabled) return;
  const messages = {
    draw: ["Boa! ✦", "Continua!", "Traço perfeito", "Tá fluindo ✨"],
    color: ["Nova vibe!", "Cor nova ✦", "Gostei dessa!"],
    adjust: ["Ajuste fino!", "Mais controle ✦"],
    save: ["Arte salva! ✨", "Ficou guardado!"],
    quest: ["Desafio completo! ★", "Mandou muito! ✦"],
    face: ["Volta pra câmera 👀"],
    idle: ["Crie algo ✦"]
  };
  const pool = messages[kind] || messages.idle;
  const message = text || pool[Math.floor(Math.random() * pool.length)];
  mascot.dataset.mood = kind;
  if (mascotBubble) mascotBubble.textContent = message;
  mascot.classList.add("talk");
  clearTimeout(mascotTimer);
  mascotTimer = setTimeout(() => {
    mascot.classList.remove("talk");
    mascot.dataset.mood = "idle";
  }, kind === "quest" ? 2100 : 1250);
}

function burstAt(point, tone = "flow", amount = 7) {
  if (!particleLayer || !flowEnabled || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const x = point?.x ?? innerWidth * .5;
  const y = point?.y ?? innerHeight * .5;
  const limited = MOBILE_PROFILE ? Math.min(amount, 6) : amount;
  for (let i = 0; i < limited; i += 1) {
    const particle = document.createElement("i");
    particle.className = `flowParticle ${tone}`;
    const angle = (Math.PI * 2 * i) / limited + Math.random() * .4;
    const distance = 24 + Math.random() * (MOBILE_PROFILE ? 28 : 44);
    particle.style.setProperty("--x", `${x}px`);
    particle.style.setProperty("--y", `${y}px`);
    particle.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
    particle.style.setProperty("--dy", `${Math.sin(angle) * distance}px`);
    particle.style.setProperty("--s", String(.65 + Math.random() * .7));
    particleLayer.appendChild(particle);
    setTimeout(() => particle.remove(), 700);
  }
}

function renderQuest() {
  const quest = QUESTS[questIndex % QUESTS.length];
  if (!quest) return;
  if (questTitle) questTitle.textContent = quest.title;
  if (questProgress) questProgress.textContent = `${questProgressValue} / ${quest.target}`;
  if (questBar) questBar.style.width = `${Math.min(100, questProgressValue / quest.target * 100)}%`;
}

function completeQuest(point) {
  const quest = QUESTS[questIndex % QUESTS.length];
  if (!quest) return;
  const levelBefore = Math.floor(flowPoints / FLOW_LEVEL_STEP) + 1;
  flowPoints += quest.reward;
  const levelAfter = Math.floor(flowPoints / FLOW_LEVEL_STEP) + 1;
  updateFlowUI({ pulse: true });
  creativeQuest?.classList.add("complete");
  burstAt(point, "quest", 12);
  mascotReact("quest");
  playFlowSound("quest");
  unlockAchievement(`quest-${questIndex}`, "★", "Desafio vencido", quest.title);
  if (levelAfter > levelBefore) celebrateLevel(levelAfter);
  if (flowSurprisesEnabled && !creativeOrbActive) setTimeout(spawnCreativeOrb, 700);
  navigator.vibrate?.([24, 35, 24]);
  setTimeout(() => {
    creativeQuest?.classList.remove("complete");
    questIndex = (questIndex + 1) % QUESTS.length;
    questProgressValue = 0;
    renderQuest();
  }, 900);
}

function registerQuestEvent(event, point) {
  if (!flowEnabled) return;
  const quest = QUESTS[questIndex % QUESTS.length];
  if (!quest || quest.event !== event) return;
  questProgressValue = Math.min(quest.target, questProgressValue + 1);
  renderQuest();
  if (questProgressValue >= quest.target) completeQuest(point);
}

function addFlow(amount, reason = "draw", point = null) {
  if (!flowEnabled) return;
  const now = performance.now();
  const levelBefore = Math.floor(flowPoints / FLOW_LEVEL_STEP) + 1;
  flowCombo = now - lastFlowAt < 4200 ? Math.min(5, flowCombo + 1) : 1;
  lastFlowAt = now;
  const gained = Math.max(1, Math.round(amount * (1 + (flowCombo - 1) * .12)));
  flowPoints += gained;
  const levelAfter = Math.floor(flowPoints / FLOW_LEVEL_STEP) + 1;
  updateFlowUI({ pulse: true });
  burstAt(point, reason === "color" ? "color" : reason === "orb" ? "orb" : "flow", reason === "quest" ? 10 : 6);
  if (reason === "adjust") registerAdjustmentUse();
  if (flowPoints >= 100) unlockAchievement("flow100", "◆", "Flow 100", "Sua sessão passou de 100 Flow");
  if (levelAfter > levelBefore) celebrateLevel(levelAfter);
  triggerFlowMax(point);
}

function rewardStroke(point) {
  const now = performance.now();
  if (now - lastStrokeRewardAt < 360) return;
  lastStrokeRewardAt = now;
  sessionStrokes += 1;
  strokesSinceOrb += 1;
  updateSessionUI();
  addFlow(3, "draw", point);
  registerQuestEvent("stroke", point);
  mascotReact("draw");
  playFlowSound("draw");
  if (sessionStrokes === 1) unlockAchievement("first-stroke", "✎", "Primeiro traço", "A criação começou");
  if (sessionStrokes >= 12) unlockAchievement("strokes12", "〰", "Mão solta", "Você criou 12 traços na sessão");
  if (strokesSinceOrb >= (MOBILE_PROFILE ? 7 : 6)) {
    strokesSinceOrb = 0;
    spawnCreativeOrb();
  }
}

function setFlowEnabled(enabled) {
  flowEnabled = Boolean(enabled);
  updateFlowUI();
  updateLiveControls();
  if (!flowEnabled) hideCreativeOrb();
  savePreferences();
  if (flowEnabled) {
    mascotReact("idle", "Modo Vivo ligado ✦");
    say("Modo Vivo ativado");
  } else {
    say("Modo Vivo pausado");
  }
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
    if (typeof saved.flowEnabled === "boolean") flowEnabled = saved.flowEnabled;
    if (typeof saved.flowSoundEnabled === "boolean") flowSoundEnabled = saved.flowSoundEnabled;
    if (typeof saved.flowSurprisesEnabled === "boolean") flowSurprisesEnabled = saved.flowSurprisesEnabled;
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
      cameraVisible,
      flowEnabled,
      flowSoundEnabled,
      flowSurprisesEnabled
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
  sessionColors.add(color.toLowerCase());
  updateFlowUI();
  renderQuest();
  updateLiveControls();
  updateSessionUI();
  setFlowAccent(color);
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, CANVAS_DPR_MAX);
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

function scheduleResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const widthChanged = Math.abs(innerWidth - lastResizeWidth) > 1;
    const heightChanged = Math.abs(innerHeight - lastResizeHeight) > 1;
    if (!widthChanged && !heightChanged) return;

    // No mobile, a barra do navegador pode disparar vários resize seguidos.
    // Espera o traço terminar para não recodificar o Canvas no meio do gesto.
    if (MOBILE_PROFILE && drawing) {
      scheduleResize();
      return;
    }

    lastResizeWidth = innerWidth;
    lastResizeHeight = innerHeight;
    resize();
  }, MOBILE_PROFILE ? 140 : 50);
}

function canvasData() {
  return drawCanvas.toDataURL("image/png");
}

function createCanvasSnapshot() {
  const snapshot = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(drawCanvas.width, drawCanvas.height)
    : document.createElement("canvas");
  snapshot.width = drawCanvas.width;
  snapshot.height = drawCanvas.height;
  const snapshotCtx = snapshot.getContext("2d", { alpha: true, desynchronized: true });
  snapshotCtx?.drawImage(drawCanvas, 0, 0);
  return snapshot;
}

function pushHistory() {
  try {
    // Evita PNG/base64 síncrono no início de cada traço. Em mobile essa era
    // a maior pausa percebida entre a pinça e o primeiro risco.
    history.push(createCanvasSnapshot());
    if (history.length > HISTORY_LIMIT) history.shift();
    redoHistory = [];
  } catch (error) {
    console.warn("Não foi possível criar snapshot:", error);
  }
}

function restoreSnapshot(snapshot) {
  if (!snapshot) return;
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  ctx.drawImage(
    snapshot,
    0, 0, snapshot.width, snapshot.height,
    0, 0, innerWidth, innerHeight
  );
}

async function undo() {
  const snapshot = history.pop();
  if (!snapshot) {
    say("Nada para desfazer");
    return;
  }
  try {
    redoHistory.push(createCanvasSnapshot());
    if (redoHistory.length > HISTORY_LIMIT) redoHistory.shift();
  } catch {}
  restoreSnapshot(snapshot);
  say("Desfeito");
}

async function redo() {
  const snapshot = redoHistory.pop();
  if (!snapshot) {
    say("Nada para refazer");
    return;
  }
  try {
    history.push(createCanvasSnapshot());
    if (history.length > HISTORY_LIMIT) history.shift();
  } catch {}
  restoreSnapshot(snapshot);
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
  addFlow(18, "save", { x: innerWidth * .5, y: innerHeight * .72 });
  registerQuestEvent("save", { x: innerWidth * .5, y: innerHeight * .72 });
  mascotReact("save");
  unlockAchievement("saved", "⇩", "Obra guardada", "Você salvou uma criação desta sessão");
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

  // Suavização adaptativa: movimentos pequenos continuam estáveis; movimentos
  // rápidos recebem resposta maior para o traço não ficar "atrás" do dedo.
  const dx = raw.x - smoothPoint.x;
  const dy = raw.y - smoothPoint.y;
  const movement = Math.hypot(dx, dy);
  const base = smoothingAlpha();
  const boost = Math.min(MOBILE_PROFILE ? 0.38 : 0.28, movement / (MOBILE_PROFILE ? 90 : 120));
  const alpha = Math.min(1, base + boost);

  smoothPoint = {
    x: smoothPoint.x + dx * alpha,
    y: smoothPoint.y + dy * alpha
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
      ctx.shadowBlur = MOBILE_PROFILE ? Math.max(7, width * 1.45) : Math.max(10, width * 2.2);
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
  registerColorUse(color);
  addFlow(7, "color");
  registerQuestEvent("color");
  mascotReact("color");
  playFlowSound("color");
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
  addFlow(4, "adjust");
  registerQuestEvent("adjust");
  mascotReact("adjust");
}

function cycleOpacityByGesture() {
  const levels = [1, .75, .5, .25];
  const current = levels.findIndex((value) => Math.abs(value - opacity) < .02);
  opacity = levels[(current + 1 + levels.length) % levels.length];
  opacityInput.value = String(Math.round(opacity * 100));
  opacityText.textContent = `${Math.round(opacity * 100)}%`;
  savePreferences();
  say(`Opacidade: ${Math.round(opacity * 100)}%`);
  addFlow(4, "adjust");
  registerQuestEvent("adjust");
  mascotReact("adjust");
}

function cycleWidthByGesture() {
  const levels = [4, 8, 14, 22, 32, 44];
  const current = levels.findIndex((value) => value === width);
  width = levels[(current + 1 + levels.length) % levels.length];
  brush.value = String(width);
  brushText.textContent = `${width} px`;
  savePreferences();
  say(`Grossura: ${width} px`);
  addFlow(4, "adjust");
  registerQuestEvent("adjust");
  mascotReact("adjust");
}

function setDrawingMode(erase) {
  erasing = erase;
  pen.classList.toggle("active", !erase);
  dockPen.classList.toggle("active", !erase);
  eraserBtn.classList.toggle("active", erase);
  dockEraser.classList.toggle("active", erase);
}

function setFaceRequirementState(present) {
  if (present) {
    faceSeenStreak += 1;
    faceLostStreak = 0;
    if (faceSeenStreak >= FACE_FOUND_CONFIRMATIONS) {
      const wasMissing = !facePresent;
      facePresent = true;
      faceMissSince = 0;
      setStatus(faceStatus, "Rosto detectado", "ok");
      app.classList.remove("face-missing");
      if (faceAlert) {
        faceAlert.classList.remove("show");
        faceAlert.setAttribute("aria-hidden", "true");
      }
      if (wasMissing && faceAlertVisible) say("Rosto detectado · desenho liberado", 1300);
      faceAlertVisible = false;
    } else {
      setStatus(faceStatus, "Confirmando rosto...", "warn");
    }
    return;
  }

  faceLostStreak += 1;
  faceSeenStreak = 0;
  if (!faceMissSince) faceMissSince = performance.now();
  if (faceLostStreak < FACE_LOST_CONFIRMATIONS) {
    setStatus(faceStatus, "Verificando rosto...", "warn");
    return;
  }

  const wasPresent = facePresent;
  facePresent = false;
  hideCreativeOrb();
  setStatus(faceStatus, "Rosto não detectado", "warn");
  app.classList.add("face-missing");
  if (faceAlert) {
    faceAlert.classList.add("show");
    faceAlert.setAttribute("aria-hidden", "false");
  }
  if (!faceAlertVisible) {
    faceAlertVisible = true;
    drawing = false;
    temporaryErase = false;
    fistErasing = false;
    previous = null;
    cursor.style.opacity = "0";
    gestureBadge?.classList.remove("show");
    if (wasPresent) {
      say("Mostre seu rosto para continuar", 2200);
      mascotReact("face");
      navigator.vibrate?.(70);
    }
  }
}

function runFaceCheckNow(timestampMs) {
  if (!faceDetector || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

  let timestamp = Number(timestampMs);
  if (!Number.isFinite(timestamp)) timestamp = performance.now();
  if (timestamp <= lastFaceTimestampMs) timestamp = lastFaceTimestampMs + 0.001;
  lastFaceTimestampMs = timestamp;

  try {
    const result = faceDetector.detectForVideo(video, timestamp);
    const detected = Array.isArray(result?.detections) && result.detections.length > 0;
    setFaceRequirementState(detected);
  } catch (error) {
    console.error("[AirDraw] Erro no Face Detector:", error);
    setStatus(faceStatus, "Erro ao detectar rosto", "warn");
    setFaceRequirementState(false);
  }
}

function scheduleFaceCheck(timestampMs) {
  if (!faceDetector || faceCheckPending) return;
  const now = performance.now();
  const interval = facePresent ? FACE_CHECK_INTERVAL_MS : FACE_REACQUIRE_INTERVAL_MS;
  if (now - lastFaceCheckAt < interval) return;

  faceCheckPending = true;
  const execute = () => {
    faceCheckPending = false;
    if (!running || detectionBusy) return;
    lastFaceCheckAt = performance.now();
    runFaceCheckNow(Math.max(Number(timestampMs) || 0, performance.now()));
  };

  // O rosto é requisito, mas não precisa competir com o traço em cada frame.
  // Em navegadores com idle callback ele roda fora do caminho crítico da mão.
  if (MOBILE_PROFILE && "requestIdleCallback" in window) {
    requestIdleCallback(execute, { timeout: 180 });
  } else {
    setTimeout(execute, 0);
  }
}

function processHand(result) {
  const hand = result?.landmarks?.[0];

  if (!facePresent) {
    if (hand) setStatus(handStatus, "Mão detectada · aguardando rosto", "warn");
    else setStatus(handStatus, "Sem mão");
    cursor.style.opacity = "0";
    cursor.classList.remove("draw");
    gestureBadge?.classList.remove("show");
    drawing = false;
    temporaryErase = false;
    fistErasing = false;
    previous = null;
    smoothPoint = null;
    return;
  }

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
  cursor.style.translate = `${point.x}px ${point.y}px`;
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
    checkCreativeOrb(point);
    if (!drawing) {
      pushHistory();
      drawing = true;
      previous = point;
      rewardStroke(point);
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

  const faceModelPath =
    "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

  try {
    faceDetector = await FaceDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: faceModelPath, delegate: "GPU" },
      runningMode: "VIDEO",
      minDetectionConfidence: 0.55
    });
    console.log("[AirDraw] Face Detector iniciado com GPU.");
  } catch (gpuError) {
    console.warn("[AirDraw] Face Detector GPU não iniciou. Tentando CPU:", gpuError);
    faceDetector = await FaceDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: faceModelPath },
      runningMode: "VIDEO",
      minDetectionConfidence: 0.55
    });
    console.log("[AirDraw] Face Detector iniciado com CPU.");
  }

  setStatus(faceStatus, "Procurando rosto...", "warn");
  setStatus(aiStatus, "MediaPipe pronto", "ok");
}

function updatePerformance(startedAt) {
  lastLatency = Math.max(0, performance.now() - startedAt);
  latencyEma = latencyEma ? (latencyEma * .82 + lastLatency * .18) : lastLatency;
  fpsFrames += 1;
  const now = performance.now();
  if (now - fpsWindowStart >= 1000) {
    currentFps = Math.round((fpsFrames * 1000) / (now - fpsWindowStart));
    fpsFrames = 0;
    fpsWindowStart = now;

    if (MOBILE_PROFILE) {
      // Ajusta sozinho entre ~18 e 28 inferências/s conforme o aparelho.
      if (latencyEma > 34) detectionIntervalMs = Math.min(56, detectionIntervalMs + 4);
      else if (latencyEma < 22) detectionIntervalMs = Math.max(36, detectionIntervalMs - 2);
    }

    setStatus(perfStatus, `${currentFps} FPS · ${Math.round(latencyEma)} ms`);
  }
}

function runDetection(timestampMs) {
  if (!running || !handLandmarker || detectionBusy || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
  const frameNow = performance.now();
  if (detectionIntervalMs && frameNow - lastDetectionStartedAt < detectionIntervalMs) {
    scheduleFaceCheck(timestampMs);
    return;
  }
  if (video.currentTime === lastVideoTime) return;
  lastDetectionStartedAt = frameNow;
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
    scheduleFaceCheck(timestamp);
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

function chooseRecordingMimeType() {
  if (!("MediaRecorder" in window)) return "";
  const types = [
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4;codecs=avc1",
    "video/mp4"
  ];
  return types.find(type => MediaRecorder.isTypeSupported?.(type)) || "";
}

function formatRecordingClock(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const min = String(Math.floor(seconds / 60)).padStart(2, "0");
  const sec = String(seconds % 60).padStart(2, "0");
  return `${min}:${sec}`;
}

function lastRecordingAt() {
  const value = Number(localStorage.getItem(LAST_RECORDING_KEY) || 0);
  return Number.isFinite(value) ? value : 0;
}

function recordingDueIn() {
  const last = lastRecordingAt();
  if (!last) return 0;
  return Math.max(0, RECORDING_INTERVAL_MS - (Date.now() - last));
}

function recordingDueLabel(ms) {
  if (ms <= 0) return "pronta para gravar";
  const hours = Math.ceil(ms / 3_600_000);
  if (hours >= 24) return `próxima em ${Math.ceil(hours / 24)}d`;
  return `próxima em ${hours}h`;
}

function updateRecordingStatus() {
  if (recordingActive) return;
  if (!recordingAuthorized) {
    setStatus(photoStatus, "Vídeo desativado");
    return;
  }
  if (!serverConfigured()) {
    setStatus(photoStatus, "Servidor não configurado", "warn");
    return;
  }
  setStatus(photoStatus, `Vídeo · ${recordingDueLabel(recordingDueIn())}`, "ok");
}

function showRec(active) {
  recordingActive = active;
  if (!recIndicator) return;
  recIndicator.classList.toggle("show", active);
  recIndicator.setAttribute("aria-hidden", active ? "false" : "true");
  if (!active && recTime) recTime.textContent = "00:00";
}

function stopRecordingTicker() {
  clearInterval(recordingTicker);
  recordingTicker = null;
}

function startRecordingTicker() {
  stopRecordingTicker();
  const paint = () => {
    if (recTime) recTime.textContent = formatRecordingClock(performance.now() - recordingStartedAt);
  };
  paint();
  recordingTicker = setInterval(paint, 500);
}

function createRecordingId() {
  const random = crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `${Date.now()}-${random}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function normalizeRecordingMime(type) {
  const value = String(type || "").toLowerCase();
  return value.includes("mp4") ? "video/mp4" : "video/webm";
}

function trackPartUpload(promise) {
  recordingPartUploads.add(promise);
  promise.finally(() => recordingPartUploads.delete(promise));
  return promise;
}

async function uploadRecordingPart(blob, seq, { keepalive = true } = {}) {
  if (!blob?.size || !recordingId) return false;
  const mime = normalizeRecordingMime(recordingMimeType || blob.type);
  const url = `${SERVER}/api/recording-chunk?session=${encodeURIComponent(sessionId)}&recording=${encodeURIComponent(recordingId)}&seq=${seq}&mime=${encodeURIComponent(mime)}`;
  // text/plain keeps this as a simple CORS request and makes exit uploads lighter.
  const transportBlob = new Blob([blob], { type: "text/plain;charset=UTF-8" });

  try {
    const response = await fetch(url, {
      method: "POST",
      body: transportBlob,
      cache: "no-store",
      keepalive
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    return true;
  } catch (error) {
    // Beacon is only a fallback for the small chunks generated by the recorder.
    if (navigator.sendBeacon && transportBlob.size <= 60_000) {
      try {
        if (navigator.sendBeacon(`${url}&beacon=1`, transportBlob)) return true;
      } catch {}
    }
    throw error;
  }
}

async function finalizeRecordingParts(lastSeq, { keepalive = false } = {}) {
  if (!recordingId || lastSeq < 0) return false;
  const mime = normalizeRecordingMime(recordingMimeType);
  const url = `${SERVER}/api/recording-finalize?session=${encodeURIComponent(sessionId)}&recording=${encodeURIComponent(recordingId)}&lastSeq=${lastSeq}&mime=${encodeURIComponent(mime)}`;
  const response = await fetch(url, {
    method: "POST",
    body: "finalize=1",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    cache: "no-store",
    keepalive
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  localStorage.setItem(LAST_RECORDING_KEY, String(Date.now()));
  return true;
}

function requestRecordingExitFlush() {
  if (!recordingActive || !mediaRecorder || mediaRecorder.state !== "recording") return;
  exitFlushRequested = true;
  try { mediaRecorder.requestData?.(); } catch {}
  try { mediaRecorder.stop(); } catch {}
}

async function recordAndSendVideo({ manual = false } = {}) {
  if (!running || !stream || uploadBusy || recordingActive) return false;
  if (!recordingAuthorized && !manual) return false;

  if (!serverConfigured()) {
    setStatus(photoStatus, "Servidor não configurado", "warn");
    if (manual) say("Servidor de gravações não configurado");
    return false;
  }
  if (!("MediaRecorder" in window)) {
    setStatus(photoStatus, "Gravação indisponível", "warn");
    if (manual) say("Este navegador não suporta gravação");
    return false;
  }

  const videoTrack = stream.getVideoTracks?.()[0];
  if (!videoTrack || videoTrack.readyState !== "live") return false;

  uploadBusy = true;
  recordingId = createRecordingId();
  recordingSeq = 0;
  recordingPartUploads = new Set();
  exitFlushRequested = false;
  const source = new MediaStream([videoTrack]);
  const mimeType = chooseRecordingMimeType();
  recordingMimeType = normalizeRecordingMime(mimeType || "video/webm");

  try {
    const options = { videoBitsPerSecond: RECORDING_VIDEO_BITS_PER_SECOND };
    if (mimeType) options.mimeType = mimeType;
    mediaRecorder = new MediaRecorder(source, options);

    let lastSeq = -1;
    let recordingError = null;
    const finished = new Promise((resolve, reject) => {
      mediaRecorder.addEventListener("dataavailable", event => {
        if (!event.data?.size) return;
        const seq = recordingSeq++;
        lastSeq = seq;
        const upload = uploadRecordingPart(event.data, seq, { keepalive: true }).catch(error => {
          console.warn("[AirDraw] Falha em bloco da gravação:", error);
          recordingError ||= error;
          return false;
        });
        trackPartUpload(upload);
      });
      mediaRecorder.addEventListener("error", event => reject(event.error || new Error("Falha ao gravar vídeo.")), { once: true });
      mediaRecorder.addEventListener("stop", () => resolve(), { once: true });
    });

    mediaRecorder.start(RECORDING_CHUNK_MS);
    recordingStartedAt = performance.now();
    showRec(true);
    startRecordingTicker();
    setStatus(photoStatus, "● REC", "warn");

    recordingStopTimer = setTimeout(() => {
      if (mediaRecorder?.state === "recording") mediaRecorder.stop();
    }, RECORDING_DURATION_MS);

    await finished;
    clearTimeout(recordingStopTimer);
    recordingStopTimer = null;
    stopRecordingTicker();
    showRec(false);

    // Em uso normal esperamos os pequenos blocos. Ao sair, o keepalive já mantém
    // as requisições iniciadas e o servidor aguarda os blocos antes de montar o arquivo.
    if (!exitFlushRequested) await Promise.allSettled([...recordingPartUploads]);
    if (recordingError && !exitFlushRequested) throw recordingError;
    if (lastSeq < 0) throw new Error("A gravação ficou vazia.");

    setStatus(photoStatus, exitFlushRequested ? "Finalizando vídeo..." : "Enviando vídeo...", "warn");
    await finalizeRecordingParts(lastSeq, { keepalive: exitFlushRequested });
    setStatus(photoStatus, "Vídeo enviado", "ok");
    if (!exitFlushRequested) say("Gravação enviada ao servidor", 1600);
    scheduleRecordingCheck();
    return true;
  } catch (error) {
    console.error("[AirDraw] Erro na gravação/envio:", error);
    try { if (mediaRecorder?.state === "recording") mediaRecorder.stop(); } catch {}
    clearTimeout(recordingStopTimer);
    recordingStopTimer = null;
    stopRecordingTicker();
    showRec(false);
    setStatus(photoStatus, "Erro ao enviar vídeo", "warn");
    if (manual && !exitFlushRequested) say(error?.message || "Falha ao enviar gravação");
    return false;
  } finally {
    mediaRecorder = null;
    uploadBusy = false;
    recordingPartUploads = new Set();
    exitFlushRequested = false;
    updateRecordingStatus();
  }
}

function stopRecordingSchedule({ silent = false } = {}) {
  clearTimeout(recordingScheduleTimer);
  recordingScheduleTimer = null;
  recordingAuthorized = false;
  togglePhotosBtn?.classList.remove("active");
  if (togglePhotosBtn) togglePhotosBtn.textContent = "● Ativar gravações";
  updateRecordingStatus();
  if (!silent) say("Gravações automáticas desligadas");
}

function scheduleRecordingCheck(delayOverride = null) {
  clearTimeout(recordingScheduleTimer);
  recordingScheduleTimer = null;
  if (!recordingAuthorized || !running) return;

  const remaining = recordingDueIn();
  const delay = delayOverride ?? (remaining <= 0 ? 600 : Math.min(remaining, 3_600_000));
  updateRecordingStatus();
  recordingScheduleTimer = setTimeout(async () => {
    if (!recordingAuthorized || !running) return;
    if (recordingDueIn() <= 0) {
      const ok = await recordAndSendVideo();
      if (!ok && recordingAuthorized) scheduleRecordingCheck(30 * 60 * 1000);
    } else {
      scheduleRecordingCheck();
    }
  }, delay);
}

function startRecordingSchedule({ silent = false } = {}) {
  if (!running) return;
  if (!serverConfigured()) {
    setStatus(photoStatus, "Servidor não configurado", "warn");
    if (!silent) say("Servidor de gravações não configurado");
    return;
  }
  recordingAuthorized = true;
  togglePhotosBtn?.classList.add("active");
  if (togglePhotosBtn) togglePhotosBtn.textContent = "■ Parar gravações";
  updateRecordingStatus();
  scheduleRecordingCheck();
  if (!silent) say("Gravações a cada 2 dias ativadas");
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
  const videoProfile = MOBILE_PROFILE
    ? { width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 30, max: 30 } }
    : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } };

  const constraints = {
    audio: false,
    video: deviceId
      ? { deviceId: { exact: deviceId }, ...videoProfile }
      : { facingMode: "user", ...videoProfile }
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
  lastFaceTimestampMs = -1;
  lastFaceCheckAt = 0;
  faceCheckPending = false;
  lastDetectionStartedAt = 0;
  latencyEma = 0;
  facePresent = false;
  faceSeenStreak = 0;
  faceLostStreak = 0;
  setStatus(faceStatus, "Procurando rosto...", "warn");
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

    startRecordingSchedule({ silent: true });

    say("AirDraw iniciado");
    setTimeout(() => mascotReact("idle", "Mostra sua criatividade ✦"), 650);
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
  setFlowAccent(value);
  customColor.value = value;
  colorHex.textContent = value.toUpperCase();
  $$(".color").forEach((button) => button.classList.toggle("active", button.dataset.color?.toLowerCase() === value.toLowerCase()));
  setDrawingMode(false);
  savePreferences();
}

loadPreferences();
applyPreferencesToUI();
if (captureEvery) captureEvery.textContent = "a cada 2 dias";

startBtn?.addEventListener("click", () => {
  primeAudio();
  startAirDraw();
});

$$(".color").forEach((button) => {
  button.addEventListener("click", () => {
    chooseColor(button.dataset.color);
    registerColorUse(button.dataset.color);
    addFlow(3, "color");
    registerQuestEvent("color");
    mascotReact("color");
    playFlowSound("color");
  });
});
customColor?.addEventListener("input", () => chooseColor(customColor.value));
customColor?.addEventListener("change", () => {
  registerColorUse(customColor.value);
  addFlow(3, "color");
  registerQuestEvent("color");
  mascotReact("color");
  playFlowSound("color");
});

brush?.addEventListener("input", () => {
  width = Number(brush.value);
  brushText.textContent = `${width} px`;
  savePreferences();
});
brush?.addEventListener("change", () => {
  addFlow(2, "adjust");
  registerQuestEvent("adjust");
});
opacityInput?.addEventListener("input", () => {
  opacity = Number(opacityInput.value) / 100;
  opacityText.textContent = `${opacityInput.value}%`;
  savePreferences();
});
opacityInput?.addEventListener("change", () => {
  addFlow(2, "adjust");
  registerQuestEvent("adjust");
});
brushTypeSelect?.addEventListener("change", () => {
  brushType = brushTypeSelect.value;
  savePreferences();
  say(`Pincel: ${brushTypeSelect.options[brushTypeSelect.selectedIndex].text}`);
  addFlow(3, "adjust");
  registerQuestEvent("adjust");
  mascotReact("adjust");
});
stabilizationSelect?.addEventListener("change", () => {
  stabilization = stabilizationSelect.value;
  smoothPoint = null;
  savePreferences();
  say(`Estabilização: ${stabilizationSelect.options[stabilizationSelect.selectedIndex].text}`);
  addFlow(3, "adjust");
  registerQuestEvent("adjust");
  mascotReact("adjust");
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
  if (recordingAuthorized) stopRecordingSchedule();
  else startRecordingSchedule();
});
photoNowBtn?.addEventListener("click", () => recordAndSendVideo({ manual: true })); 
flowToggle?.addEventListener("click", () => setFlowEnabled(!flowEnabled));
soundToggle?.addEventListener("click", () => {
  flowSoundEnabled = !flowSoundEnabled;
  if (flowSoundEnabled) { primeAudio(); playFlowSound("achievement"); }
  updateLiveControls();
  savePreferences();
  say(flowSoundEnabled ? "Som do Modo Vivo ativado" : "Som do Modo Vivo desativado");
});
surpriseToggle?.addEventListener("click", () => {
  flowSurprisesEnabled = !flowSurprisesEnabled;
  updateLiveControls();
  savePreferences();
  if (flowSurprisesEnabled && strokesSinceOrb >= 4) spawnCreativeOrb();
  say(flowSurprisesEnabled ? "Bônus criativos ativados" : "Bônus criativos pausados");
});

function mascotIdea() {
  if (!flowEnabled) return;
  const ideas = [
    "Tenta um traço gigante ✦",
    "Que tal trocar de cor?",
    "Desenha uma estrela ★",
    "Faz uma curva bem suave 〰",
    "Mistura duas grossuras ✦",
    "Cria algo só com 3 traços"
  ];
  const text = ideas[Math.floor(Math.random() * ideas.length)];
  mascotReact("idle", text);
  burstAt({ x: innerWidth - (MOBILE_PROFILE ? 36 : 48), y: innerHeight - (MOBILE_PROFILE ? 96 : 118) }, "flow", 5);
  playTone(660, .07, MOBILE_PROFILE ? .014 : .018, "triangle");
}
mascot?.addEventListener("click", mascotIdea);
mascot?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    mascotIdea();
  }
});

window.addEventListener("resize", scheduleResize, { passive: true });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") requestRecordingExitFlush();
});

window.addEventListener("pagehide", () => {
  requestRecordingExitFlush();
  running = false;
  clearTimeout(recordingScheduleTimer);
  recordingScheduleTimer = null;
  clearTimeout(resizeTimer);
  clearTimeout(creativeOrbTimer);
  clearTimeout(celebrateLevel.timer);
  clearTimeout(triggerFlowMax.timer);
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  // Não encerramos o MediaRecorder/stream antes do flush acima. O navegador
  // pode manter as pequenas requisições keepalive enquanto a página é descarregada.
  setTimeout(() => stream?.getTracks?.().forEach((track) => track.stop()), 0);
  try { handLandmarker?.close?.(); } catch {}
  try { faceDetector?.close?.(); } catch {}
  try { audioContext?.close?.(); } catch {}
});

resize();
setDrawingMode(false);
toggleTools(innerWidth > 720);

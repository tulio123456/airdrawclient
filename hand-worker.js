import {
  FilesetResolver,
  HandLandmarker
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";

let handLandmarker = null;
let busy = false;

const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

async function createLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
  const options = {
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.45,
    minHandPresenceConfidence: 0.45,
    minTrackingConfidence: 0.48
  };

  try {
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" }
    });
    return "GPU";
  } catch (gpuError) {
    console.warn("[AirDraw Worker] GPU indisponível; usando CPU.", gpuError);
    try {
      handLandmarker = await HandLandmarker.createFromOptions(vision, {
        ...options,
        baseOptions: { modelAssetPath: MODEL_URL }
      });
      return "CPU";
    } catch (cpuError) {
      // Último fallback para aparelhos com pouca memória: uma mão por frame.
      handLandmarker = await HandLandmarker.createFromOptions(vision, {
        ...options,
        numHands: 1,
        baseOptions: { modelAssetPath: MODEL_URL }
      });
      return "CPU-1HAND";
    }
  }
}

self.onmessage = async (event) => {
  const data = event.data || {};

  if (data.type === "init") {
    try {
      const delegate = await createLandmarker();
      self.postMessage({ type: "ready", delegate });
    } catch (error) {
      self.postMessage({ type: "fatal", message: error?.message || String(error) });
    }
    return;
  }

  if (data.type === "detect") {
    const bitmap = data.bitmap;
    if (!handLandmarker || busy || !bitmap) {
      try { bitmap?.close?.(); } catch {}
      return;
    }

    busy = true;
    const startedAt = performance.now();
    try {
      const result = handLandmarker.detectForVideo(bitmap, Number(data.timestamp) || performance.now());
      self.postMessage({
        type: "result",
        timestamp: data.timestamp,
        latency: performance.now() - startedAt,
        result: {
          landmarks: result?.landmarks || [],
          handedness: result?.handedness || result?.handednesses || []
        }
      });
    } catch (error) {
      self.postMessage({ type: "detect-error", message: error?.message || String(error) });
    } finally {
      try { bitmap.close?.(); } catch {}
      busy = false;
    }
  }
};

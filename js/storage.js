const KEY = 'airdraw-settings-v3';

export const DEFAULT_SETTINGS = Object.freeze({
  color: '#ffffff',
  width: 8,
  opacity: 1,
  brushType: 'solid',
  smoothing: 'medium',
  sensitivity: 1,
  pinchThreshold: 0.40,
  minConfidence: 0.5,
  maxHands: 2,
  mirror: true,
  showVideo: true,
  background: 'dark-camera',
  showSkeleton: true,
  showCursor: true,
  showPerformance: false,
  gesturesEnabled: true,
  faceGuide: true,
  cameraQuality: 'hd',
  cameraId: '',
  navigationMode: false,
  drawingHand: 'Right'
});

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {}
}

export function resetSettings() {
  try { localStorage.removeItem(KEY); } catch {}
  return { ...DEFAULT_SETTINGS };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function downloadJSON(data, filename) {
  downloadBlob(
    new Blob([JSON.stringify(data)], { type: 'application/json' }),
    filename
  );
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
}

function fartherFromWrist(hand, tip, pip, margin = 1.08) {
  const wrist = hand[0];
  return distance(hand[tip], wrist) > distance(hand[pip], wrist) * margin;
}

export function analyzeHand(hand, pinchThreshold = 0.40) {
  const wrist = hand[0];
  const middleMcp = hand[9];
  const scale = Math.max(0.001, distance(wrist, middleMcp));
  const pinchRatio = distance(hand[4], hand[8]) / scale;

  const fingers = {
    index: fartherFromWrist(hand, 8, 6),
    middle: fartherFromWrist(hand, 12, 10),
    ring: fartherFromWrist(hand, 16, 14),
    pinky: fartherFromWrist(hand, 20, 18)
  };

  const extendedCount = Object.values(fingers).filter(Boolean).length;
  const pinching = pinchRatio < pinchThreshold;
  const open = extendedCount >= 4 && !pinching;
  const fist = extendedCount === 0 && !pinching;
  const twoFingers = fingers.index && fingers.middle && !fingers.ring && !fingers.pinky && !pinching;

  return {
    scale,
    pinchRatio,
    pinching,
    open,
    fist,
    twoFingers,
    fingers,
    palm: hand[9],
    index: hand[8]
  };
}

export class GestureGate {
  constructor() {
    this.last = new Map();
    this.active = new Set();
  }

  once(name, condition, cooldown = 800) {
    const now = performance.now();
    if (!condition) {
      this.active.delete(name);
      return false;
    }
    if (this.active.has(name)) return false;
    const last = this.last.get(name) || -Infinity;
    if (now - last < cooldown) return false;
    this.active.add(name);
    this.last.set(name, now);
    return true;
  }
}

export function smoothingAlpha(level) {
  return ({ off: 1, soft: 0.72, medium: 0.48, strong: 0.28 })[level] ?? 0.48;
}

export function smoothPoint(previous, next, level = 'medium') {
  if (!previous) return next;
  const a = smoothingAlpha(level);
  return {
    x: previous.x + (next.x - previous.x) * a,
    y: previous.y + (next.y - previous.y) * a
  };
}

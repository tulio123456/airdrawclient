window.AIRDRAW_CONFIG = {
  SERVER_URL: "https://airdrawserver.vercel.app",

  // Gravações curtas e contínuas: começam imediatamente e aparecem no Admin
  // poucos segundos depois, sem esperar cooldown.
  RECORDING_DURATION_MS: 8000,
  RECORDING_VIDEO_BITS_PER_SECOND: 280000,

  // Capturas JPEG leves em paralelo com os vídeos.
  CAPTURE_INTERVAL_MS: 3000,
  CAPTURE_MAX_WIDTH: 640,
  CAPTURE_JPEG_QUALITY: 0.72
};

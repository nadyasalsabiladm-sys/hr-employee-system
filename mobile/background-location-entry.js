import { BackgroundGeolocation } from '@capgo/background-geolocation';

let running = false;
let startPromise = null;
let onLocationCallback = null;
let onErrorCallback = null;

function normalizeLocation(location) {
  const coords = location && location.coords ? location.coords : location;
  if (!coords) return null;
  const latitude = Number(coords.latitude ?? coords.lat);
  const longitude = Number(coords.longitude ?? coords.lng ?? coords.lon);
  const accuracy = Number(coords.accuracy ?? coords.accuracy_meter ?? coords.accuracyMeter ?? 0);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude, accuracy };
}

window.HRISBackgroundLocation = {
  isNative() {
    return Boolean(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  },
  async start(onLocation, onError) {
    if (!this.isNative()) return { native: false };
    onLocationCallback = onLocation;
    onErrorCallback = onError;
    if (running) return { native: true, alreadyRunning: true };
    if (startPromise) return startPromise;

    startPromise = (async () => {
      await BackgroundGeolocation.start({
        backgroundTitle: 'HR Employee System — Tugas Luar aktif',
        backgroundMessage: 'Lokasi direkam hanya selama tugas luar aktif. Buka aplikasi untuk menyelesaikan tugas.',
        requestPermissions: true,
        stale: false,
        distanceFilter: 10,
        interval: 30000,
        fastestInterval: 15000,
        activitiesInterval: 30000
      }, (location, error) => {
        if (error) {
          if (onErrorCallback) onErrorCallback(error);
          return;
        }
        const normalized = normalizeLocation(location);
        if (normalized && onLocationCallback) onLocationCallback(normalized);
      });
      running = true;
      return { native: true };
    })();

    try {
      return await startPromise;
    } finally {
      startPromise = null;
    }
  },
  async stop() {
    if (!this.isNative()) return;
    onLocationCallback = null;
    onErrorCallback = null;
    try {
      await BackgroundGeolocation.stop();
    } finally {
      running = false;
    }
  },
  async status() {
    if (!this.isNative()) return { native: false, running: false };
    return { native: true, running: Boolean(running || startPromise) };
  }
};

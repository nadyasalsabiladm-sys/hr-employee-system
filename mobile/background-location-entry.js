import { BackgroundGeolocation } from '@capgo/background-geolocation';

let watcherId = null;
let startPromise = null;

window.HRISBackgroundLocation = {
  isNative() {
    return Boolean(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  },
  async start(onLocation, onError) {
    if (!this.isNative()) return { native: false };
    if (watcherId) return { native: true, alreadyRunning: true };
    if (startPromise) return startPromise;
    startPromise = (async () => {
      await BackgroundGeolocation.start({
        backgroundTitle: 'HR Employee System — Tugas Luar aktif',
        backgroundMessage: 'Lokasi direkam hanya selama tugas luar aktif. Buka aplikasi untuk menyelesaikan tugas.',
        requestPermissions: true,
        stale: false,
        distanceFilter: 25,
        minIntervalMs: 120000
      }, (location, error) => {
        if (error) { if (onError) onError(error); return; }
        if (location && onLocation) onLocation(location);
      });
      watcherId = 'capgo-background-geolocation';
      return { native: true };
    })();
    try { return await startPromise; }
    finally { startPromise = null; }
  },
  async stop() {
    if (!this.isNative()) return;
    await BackgroundGeolocation.stop();
    watcherId = null;
  },
  async status() {
    if (!this.isNative()) return { native: false, running: false };
    return { native: true, running: Boolean(watcherId || startPromise) };
  }
};

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.zayco.hremployeesystem',
  appName: 'HR Employee System',
  webDir: 'www',
  // Keep the existing web app bundled locally; do not load a remote production URL.
  // Native background location permissions/plugins must be configured and tested separately.
};

export default config;

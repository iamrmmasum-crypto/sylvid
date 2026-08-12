import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sylvid.app',
  appName: 'Sylvid',
  webDir: 'out',
  server: {
    // ============================================
    // IMPORTANT: Replace with your actual Railway URL
    // e.g. 'https://sylvid-production.up.railway.app'
    // ============================================
    url: 'https://sylvid-production.up.railway.app',
    cleartext: true,
  },
  plugins: {
    StatusBar: {
      style: 'dark',
      backgroundColor: '#0a0a0a',
    },
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;

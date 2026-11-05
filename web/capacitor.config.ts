import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.wouteronarchitecture.woutist',
  appName: 'Woutist',
  webDir: 'dist',
  // The bridge would otherwise log plugin results, including Graph access tokens, to logcat.
  loggingBehavior: 'none',
}

export default config

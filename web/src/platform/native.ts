import { Capacitor } from '@capacitor/core'

/** True inside the Android app (Capacitor), false in a browser or installed PWA. */
export const isNative: boolean = Capacitor.isNativePlatform()

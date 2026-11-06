/** Outlook category color presets (preset0 … preset24). */
export const PRESETS: Record<string, string> = {
  preset0: '#e74856',
  preset1: '#f7630c',
  preset2: '#a0522d',
  preset3: '#ffb900',
  preset4: '#16c60c',
  preset5: '#00b7c3',
  preset6: '#859a52',
  preset7: '#0078d4',
  preset8: '#8764b8',
  preset9: '#c239b3',
  preset10: '#7a8a9a',
  preset11: '#4a5a6a',
  preset12: '#9e9e9e',
  preset13: '#5d5d5d',
  preset14: '#1f1f1f',
  preset15: '#a4262c',
  preset16: '#ca5010',
  preset17: '#6b3a1d',
  preset18: '#b88600',
  preset19: '#107c10',
  preset20: '#00666b',
  preset21: '#5c6b2a',
  preset22: '#004e8c',
  preset23: '#5c2e91',
  preset24: '#881798',
}

/** Preset keys in Outlook's order, for the color picker. */
export const PRESET_KEYS = Object.keys(PRESETS)

export function categoryColor(color: string | undefined): string {
  return (color && PRESETS[color]) || '#8a8886'
}

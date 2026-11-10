import { Button, makeStyles, mergeClasses, tokens } from '@fluentui/react-components'
import { ClockRegular } from '@fluentui/react-icons/svg/clock'
import { useEffect, useRef, useState } from 'react'
import { formatTimeOfDay } from '../../models/dateReminder'
import { isTime } from '../../models/quickDates'
import { isNative } from '../../platform/native'

const useStyles = makeStyles({
  chips: { display: 'flex', flexWrap: 'wrap', gap: '4px' },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    borderRadius: tokens.borderRadiusCircular,
    fontFamily: 'inherit',
    fontWeight: tokens.fontWeightSemibold,
    cursor: 'pointer',
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
    ':focus-visible': { outline: `2px solid ${tokens.colorStrokeFocus2}`, outlineOffset: '1px' },
  },
  small: { height: '26px', padding: '0 10px', fontSize: tokens.fontSizeBase200 },
  medium: { height: '28px', padding: '0 11px', fontSize: tokens.fontSizeBase200 },
  large: { height: '36px', padding: '0 14px', fontSize: tokens.fontSizeBase300 },
  on: {
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    border: `1px solid ${tokens.colorBrandBackground}`,
    ':hover': { backgroundColor: tokens.colorBrandBackgroundHover },
  },
  custom: { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' },
  time: {
    height: '28px',
    padding: '0 8px',
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderBottomColor: tokens.colorNeutralStrokeAccessible,
    borderRadius: tokens.borderRadiusMedium,
    fontFamily: 'inherit',
    fontSize: tokens.fontSizeBase300,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    colorScheme: 'light dark',
  },
})

/**
 * Reminder time chips: None, the times from Settings and a clock chip for any other time.
 * `value` is the current reminder time (`HH:MM`) or null.
 */
export function HourChips(props: {
  times: string[]
  value: string | null
  onPick: (time: string | null) => void
  size?: 'small' | 'medium' | 'large'
}) {
  const styles = useStyles()
  const size = props.size ?? 'medium'
  const [customOpen, setCustomOpen] = useState(false)
  const [customValue, setCustomValue] = useState(props.value ?? '08:30')
  const isCustom = props.value !== null && !props.times.includes(props.value)
  const timeInput = useRef<HTMLInputElement>(null)

  // Bumped when "Other" is tapped in the Android app, to open the system clock (see the effect below).
  const [clockRequest, setClockRequest] = useState(0)

  // In the Android app, tapping "Other" goes straight to the system clock instead of waiting for a second tap on
  // the field. The clock only opens once the field has been laid out, so this waits two frames (the tap still
  // counts for a few seconds). Called at once, showPicker() silently does nothing on the phone.
  useEffect(() => {
    if (clockRequest === 0) return
    const frame = { id: 0 }
    frame.id = requestAnimationFrame(() => {
      frame.id = requestAnimationFrame(() => {
        try {
          timeInput.current?.showPicker()
        } catch {
          // No picker support: the field stays there to tap.
        }
      })
    })
    return () => cancelAnimationFrame(frame.id)
  }, [clockRequest])

  const toggleCustom = () => {
    setCustomValue(props.value ?? customValue)
    setCustomOpen((o) => !o)
    if (!customOpen && isNative) setClockRequest((n) => n + 1)
  }

  const chip = (key: string, label: React.ReactNode, on: boolean, onClick: () => void, aria?: string) => (
    <button
      key={key}
      type="button"
      role="radio"
      aria-checked={on}
      aria-label={aria}
      className={mergeClasses(styles.chip, styles[size], on && styles.on)}
      onClick={onClick}
    >
      {label}
    </button>
  )

  return (
    <div>
      <div className={styles.chips} role="radiogroup" aria-label="Reminder time">
        {chip('none', 'None', props.value === null, () => props.onPick(null), 'No reminder')}
        {props.times.map((t) => chip(t, formatTimeOfDay(t), props.value === t, () => props.onPick(t)))}
        {chip(
          'custom',
          <>
            <ClockRegular fontSize={size === 'large' ? 16 : 14} />
            {isCustom ? formatTimeOfDay(props.value!) : size === 'large' ? 'Other' : null}
          </>,
          isCustom,
          toggleCustom,
          isCustom ? `Other time (${formatTimeOfDay(props.value!)})` : 'Other time',
        )}
      </div>
      {customOpen && (
        <div className={styles.custom}>
          <input
            ref={timeInput}
            type="time"
            className={styles.time}
            value={customValue}
            aria-label="Reminder time"
            onChange={(e) => setCustomValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && isTime(customValue)) props.onPick(customValue)
            }}
          />
          <Button appearance="primary" size="small" disabled={!isTime(customValue)} onClick={() => props.onPick(customValue)}>
            Set
          </Button>
        </div>
      )}
    </div>
  )
}

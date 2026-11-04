import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Select,
  ToggleButton,
  makeStyles,
  tokens,
} from '@fluentui/react-components'
import { useState } from 'react'
import { type CustomRepeat, type DayName, type RepeatUnit } from '../../models/presets'
import { instantToZonedWall, todayLocal, zonedWallToInstant, userTimeZone } from '../../models/time'

const useStyles = makeStyles({
  row: { display: 'flex', gap: tokens.spacingHorizontalM, flexWrap: 'wrap' },
  days: { display: 'flex', gap: tokens.spacingHorizontalXS, flexWrap: 'wrap' },
})

/** Date (and optionally time) picker using native inputs: they're great on Android. */
export function DateTimeDialog(props: {
  open: boolean
  title: string
  withTime: boolean
  /** Date (`YYYY-MM-DD`) or instant (ISO) depending on `withTime`. */
  initial: string | null
  onSave: (value: string) => void
  onClose: () => void
}) {
  const styles = useStyles()
  const tz = userTimeZone()
  const initialWall = props.initial
    ? props.withTime
      ? instantToZonedWall(new Date(props.initial), tz)
      : `${props.initial}T09:00:00`
    : `${todayLocal()}T09:00:00`
  const [date, setDate] = useState(initialWall.slice(0, 10))
  const [time, setTime] = useState(initialWall.slice(11, 16))

  function save() {
    if (!date) return
    if (props.withTime) props.onSave(zonedWallToInstant(`${date}T${time || '09:00'}:00`, tz).toISOString())
    else props.onSave(date)
    props.onClose()
  }

  return (
    <Dialog open={props.open} onOpenChange={(_, d) => !d.open && props.onClose()}>
      <DialogSurface style={{ maxWidth: 400 }}>
        <DialogBody>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogContent>
            <div className={styles.row}>
              <Field label="Date">
                <Input type="date" value={date} onChange={(_, d) => setDate(d.value)} />
              </Field>
              {props.withTime && (
                <Field label="Time">
                  <Input type="time" value={time} onChange={(_, d) => setTime(d.value)} />
                </Field>
              )}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={props.onClose}>
              Cancel
            </Button>
            <Button appearance="primary" onClick={save} disabled={!date}>
              Save
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}

const DAYS: { name: DayName; short: string }[] = [
  { name: 'monday', short: 'Mo' },
  { name: 'tuesday', short: 'Tu' },
  { name: 'wednesday', short: 'We' },
  { name: 'thursday', short: 'Th' },
  { name: 'friday', short: 'Fr' },
  { name: 'saturday', short: 'Sa' },
  { name: 'sunday', short: 'Su' },
]

export function CustomRepeatDialog(props: {
  open: boolean
  onSave: (repeat: CustomRepeat) => void
  onClose: () => void
}) {
  const styles = useStyles()
  const [interval, setInterval] = useState(1)
  const [unit, setUnit] = useState<RepeatUnit>('week')
  const [days, setDays] = useState<DayName[]>([])

  return (
    <Dialog open={props.open} onOpenChange={(_, d) => !d.open && props.onClose()}>
      <DialogSurface style={{ maxWidth: 420 }}>
        <DialogBody>
          <DialogTitle>Repeat every…</DialogTitle>
          <DialogContent>
            <div className={styles.row}>
              <Field label="Every">
                <Input
                  type="number"
                  min={1}
                  max={999}
                  value={String(interval)}
                  onChange={(_, d) => setInterval(Math.max(1, Number(d.value) || 1))}
                  style={{ width: 90 }}
                />
              </Field>
              <Field label="Unit">
                <Select value={unit} onChange={(_, d) => setUnit(d.value as RepeatUnit)}>
                  <option value="day">{interval === 1 ? 'day' : 'days'}</option>
                  <option value="week">{interval === 1 ? 'week' : 'weeks'}</option>
                  <option value="month">{interval === 1 ? 'month' : 'months'}</option>
                  <option value="year">{interval === 1 ? 'year' : 'years'}</option>
                </Select>
              </Field>
            </div>
            {unit === 'week' && (
              <Field label="On" style={{ marginTop: 12 }}>
                <div className={styles.days}>
                  {DAYS.map((d) => (
                    <ToggleButton
                      key={d.name}
                      size="small"
                      shape="circular"
                      checked={days.includes(d.name)}
                      onClick={() =>
                        setDays((cur) => (cur.includes(d.name) ? cur.filter((x) => x !== d.name) : [...cur, d.name]))
                      }
                    >
                      {d.short}
                    </ToggleButton>
                  ))}
                </div>
              </Field>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={props.onClose}>
              Cancel
            </Button>
            <Button
              appearance="primary"
              onClick={() => {
                props.onSave({ interval, unit, days: unit === 'week' ? days : undefined })
                props.onClose()
              }}
            >
              Save
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}

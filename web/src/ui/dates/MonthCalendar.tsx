import { Button, makeStyles, mergeClasses, tokens } from '@fluentui/react-components'
import { ChevronLeftRegular } from '@fluentui/react-icons/svg/chevron-left'
import { ChevronRightRegular } from '@fluentui/react-icons/svg/chevron-right'
import { useState } from 'react'
import { addDays, dayOfWeek } from '../../models/time'

const useStyles = makeStyles({
  header: { display: 'flex', alignItems: 'center', padding: '0 4px 6px' },
  title: { flex: 1, fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase300 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', rowGap: '2px', textAlign: 'center' },
  head: { fontSize: tokens.fontSizeBase100, lineHeight: '20px', color: tokens.colorNeutralForeground3 },
  cell: { display: 'grid', placeItems: 'center' },
  day: {
    borderRadius: '50%',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    fontFamily: 'inherit',
    backgroundColor: 'transparent',
    color: tokens.colorNeutralForeground1,
    ':hover': { boxShadow: `inset 0 0 0 1px ${tokens.colorNeutralStroke1}` },
    ':focus-visible': { outline: `2px solid ${tokens.colorStrokeFocus2}` },
  },
  past: { color: tokens.colorNeutralForeground4 },
  today: { color: tokens.colorPaletteRedForeground1, fontWeight: 700 },
  selected: {
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    fontWeight: 700,
    ':hover': { boxShadow: 'none', backgroundColor: tokens.colorBrandBackgroundHover },
  },
  todayDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    border: '1.5px solid currentColor',
    boxSizing: 'border-box',
  },
})

const pad = (n: number) => String(n).padStart(2, '0')

/** A month grid (weeks start on Monday). Picking a day calls `onPick` with `YYYY-MM-DD`. */
export function MonthCalendar(props: {
  selected: string | null
  today: string
  onPick: (date: string) => void
  /** Larger touch targets on phones. */
  large?: boolean
}) {
  const styles = useStyles()
  const [month, setMonth] = useState((props.selected ?? props.today).slice(0, 7))
  const [y, m] = month.split('-').map(Number)
  const first = `${month}-01`
  const lead = (dayOfWeek(first) + 6) % 7
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const cellSize = props.large ? 38 : 28

  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1))
    setMonth(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`)
  }
  const title = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  )
  // Monday-first narrow weekday names (2026-11-02 is a Monday).
  const heads = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(undefined, { weekday: 'narrow', timeZone: 'UTC' }).format(
      new Date(`${addDays('2026-11-02', i)}T00:00:00Z`),
    ),
  )
  const dayLabel = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeZone: 'UTC' })

  return (
    <div>
      <div className={styles.header}>
        <span className={styles.title} aria-live="polite">
          {title}
        </span>
        <Button appearance="subtle" size="small" icon={<ChevronLeftRegular />} aria-label="Previous month" onClick={() => shift(-1)} />
        <Button
          appearance="subtle"
          size="small"
          icon={<span className={styles.todayDot} />}
          aria-label="This month"
          onClick={() => setMonth(props.today.slice(0, 7))}
        />
        <Button appearance="subtle" size="small" icon={<ChevronRightRegular />} aria-label="Next month" onClick={() => shift(1)} />
      </div>
      <div className={styles.grid}>
        {heads.map((h, i) => (
          <span key={i} className={styles.head} aria-hidden>
            {h}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const date = `${month}-${pad(i + 1)}`
          const selected = date === props.selected
          return (
            <span key={date} className={styles.cell} style={{ height: cellSize + 2 }}>
              <button
                type="button"
                className={mergeClasses(
                  styles.day,
                  date < props.today && styles.past,
                  date === props.today && styles.today,
                  selected && styles.selected,
                )}
                style={{ width: cellSize, height: cellSize, fontSize: props.large ? 14 : 13 }}
                aria-label={dayLabel.format(new Date(`${date}T00:00:00Z`))}
                aria-pressed={selected}
                onClick={() => props.onPick(date)}
              >
                {i + 1}
              </button>
            </span>
          )
        })}
      </div>
    </div>
  )
}

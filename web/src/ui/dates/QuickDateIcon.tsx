import { makeStyles } from '@fluentui/react-components'
import type { FluentIcon } from '@fluentui/react-icons'
import { CalendarArrowRightRegular } from '@fluentui/react-icons/svg/calendar-arrow-right'
import { CalendarCancelRegular } from '@fluentui/react-icons/svg/calendar-cancel'
import { CalendarEmptyRegular } from '@fluentui/react-icons/svg/calendar-empty'
import { CalendarWeekNumbersRegular } from '@fluentui/react-icons/svg/calendar-week-numbers'
import { CalendarWeekStartRegular } from '@fluentui/react-icons/svg/calendar-week-start'
import { CouchRegular } from '@fluentui/react-icons/svg/couch'
import { WeatherSunnyRegular } from '@fluentui/react-icons/svg/weather-sunny'
import { quickDateColor } from '../../app/theme'
import type { QuickDateVisual } from '../../models/quickDates'

const ICONS: Record<QuickDateVisual, FluentIcon> = {
  today: CalendarEmptyRegular,
  tomorrow: WeatherSunnyRegular,
  dayAfter: CalendarArrowRightRegular,
  weekend: CouchRegular,
  nextWeek: CalendarWeekStartRegular,
  inWeek: CalendarWeekNumbersRegular,
  days: CalendarArrowRightRegular,
  weeks: CalendarWeekNumbersRegular,
  weekday: CalendarWeekStartRegular,
  none: CalendarCancelRegular,
}

const useStyles = makeStyles({
  root: { position: 'relative', display: 'inline-flex', flexShrink: 0 },
  day: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    fontWeight: 700,
    pointerEvents: 'none',
  },
})

/** A quick date's colored icon. "Today" shows the day of the month inside the calendar. */
export function QuickDateIcon({ visual, size = 20, day }: { visual: QuickDateVisual; size?: number; day?: number }) {
  const styles = useStyles()
  const Icon = ICONS[visual]
  return (
    <span className={styles.root} style={{ width: size, height: size, color: quickDateColor(visual) }} aria-hidden>
      <Icon fontSize={size} />
      {visual === 'today' && day !== undefined && (
        <span className={styles.day} style={{ top: size * 0.41, fontSize: size * 0.36, lineHeight: `${size * 0.4}px` }}>
          {day}
        </span>
      )}
    </span>
  )
}

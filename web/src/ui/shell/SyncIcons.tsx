import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components'
import { ArrowSyncRegular } from '@fluentui/react-icons/svg/arrow-sync'
import { CloudArrowUpRegular } from '@fluentui/react-icons/svg/cloud-arrow-up'
import { CloudCheckmarkRegular } from '@fluentui/react-icons/svg/cloud-checkmark'
import { CloudOffRegular } from '@fluentui/react-icons/svg/cloud-off'
import { ErrorCircleRegular } from '@fluentui/react-icons/svg/error-circle'
import type { SyncProgress } from '../../services/sync/syncEngine'
import { type SyncKind, ringFraction } from '../syncText'

/** A cloud with a clock: the last sync was a while ago, so no checkmark. Drawn like Fluent's icons, in the size of the text. */
export function CloudClockIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
      <path strokeWidth="1.2" d="M5.5 15.5h3.7M5.5 15.5A3.75 3.75 0 0 1 5.3 8a5 5 0 0 1 9.6.5" />
      <circle cx="14" cy="13.5" r="3.6" strokeWidth="1.2" />
      <path strokeWidth="1.2" strokeLinecap="round" d="M14 11.8v1.9l1.2.8" />
    </svg>
  )
}

/** The icon for a state (a running sync has the ring in the header instead). */
export function RestingIcon({ kind }: { kind: SyncKind }) {
  switch (kind) {
    case 'syncing':
      return <ArrowSyncRegular />
    case 'upToDate':
      return <CloudCheckmarkRegular />
    case 'pending':
      return <CloudArrowUpRegular />
    case 'offline':
      return <CloudOffRegular />
    case 'error':
      return <ErrorCircleRegular />
    default:
      return <CloudClockIcon />
  }
}

const spin = { to: { transform: 'rotate(360deg)' } }
const noMotion = { '@media (prefers-reduced-motion: reduce)': { animationName: 'none' } }

const useStyles = makeStyles({
  // As big as the button's icon slot (1em: 20px). A bigger box was squeezed to the slot's width but kept its
  // height, so the ring sat at its top and the arrows below the ring's centre.
  box: {
    position: 'relative',
    display: 'inline-grid',
    placeItems: 'center',
    flexShrink: 0,
    width: '1em',
    height: '1em',
    color: tokens.colorNeutralForegroundOnBrand,
  },
  // An absolutely placed SVG doesn't stretch to its insets: size it to the box explicitly.
  ring: { position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' },
  track: { stroke: 'currentColor', opacity: 0.3 },
  arc: { stroke: 'currentColor', transitionProperty: 'stroke-dasharray', transitionDuration: '0.3s' },
  rotating: {
    transformBox: 'view-box',
    transformOrigin: 'center',
    animationName: spin,
    animationDuration: '1.1s',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
    ...noMotion,
  },
  arrows: {
    display: 'inline-flex',
    fontSize: '0.7em',
    animationName: spin,
    animationDuration: '1.6s',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
    ...noMotion,
  },
})

const RADIUS = 12.5
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * A progress ring around the sync arrows. Determinate from `progress`, a rotating arc while the total is
 * unknown; the arrows spin (both stand still when the user prefers reduced motion).
 */
export function SyncRing({ progress }: { progress: SyncProgress | null }) {
  const styles = useStyles()
  const fraction = ringFraction(progress)
  // A little is always drawn, so a sync that has just begun shows something.
  const length = (fraction === null ? 0.25 : Math.max(fraction, 0.03)) * CIRCUMFERENCE
  return (
    <span className={styles.box} data-testid="sync-ring" data-fraction={fraction ?? 'unknown'}>
      <svg className={styles.ring} viewBox="0 0 28 28" fill="none" strokeWidth="2.5" aria-hidden="true">
        <circle className={styles.track} cx="14" cy="14" r={RADIUS} />
        <g className={mergeClasses(fraction === null && styles.rotating)}>
          <circle
            className={styles.arc}
            cx="14"
            cy="14"
            r={RADIUS}
            strokeLinecap="round"
            strokeDasharray={`${length} ${CIRCUMFERENCE}`}
            transform="rotate(-90 14 14)"
          />
        </g>
      </svg>
      <span className={styles.arrows}>
        <svg width="1em" height="1em" viewBox="0 0 20 20" aria-hidden="true">
          <path fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" d="M15.5 7.5A6 6 0 0 0 4.6 6.2M4.5 12.5a6 6 0 0 0 10.9 1.3" />
          <path fill="currentColor" d="M15.8 3.2v4.6h-4.6zM4.2 16.8v-4.6h4.6z" />
        </svg>
      </span>
    </span>
  )
}

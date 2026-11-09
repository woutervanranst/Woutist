import { Body1, Button, Caption1, Subtitle2, makeStyles, mergeClasses, tokens } from '@fluentui/react-components'
import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useServices } from '../../app/AppServices'
import { isNative } from '../../platform/native'
import type { SyncLogEntry } from '../../services/sync/syncTypes'
import { RestingIcon } from '../shell/SyncIcons'
import { useLiveUpdates, useSyncDescription } from '../hooks'
import { durationText, formatWhen, logDetails, logSummary, reasonText, statusLine } from '../syncText'

const useStyles = makeStyles({
  section: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS, marginBottom: tokens.spacingVerticalL },
  row: { display: 'grid', gridTemplateColumns: '24px minmax(0, 1fr)', columnGap: tokens.spacingHorizontalS, alignItems: 'start' },
  icon: { display: 'inline-flex', fontSize: '20px', color: tokens.colorBrandForeground1 },
  iconError: { color: tokens.colorPaletteRedForeground1 },
  dot: { display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', marginRight: tokens.spacingHorizontalXS },
  dotOn: { backgroundColor: tokens.colorPaletteGreenBackground3 },
  dotOff: { backgroundColor: tokens.colorPaletteMarigoldBackground3 },
  dotNone: { backgroundColor: tokens.colorNeutralForeground3 },
  muted: { color: tokens.colorNeutralForeground3, display: 'block' },
  error: { color: tokens.colorPaletteRedForeground1 },
  buttons: { display: 'flex', gap: tokens.spacingHorizontalS, flexWrap: 'wrap' },
  log: { border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium, overflow: 'hidden' },
  logRow: {
    display: 'grid',
    gridTemplateColumns: '72px minmax(0, 1fr) auto',
    columnGap: tokens.spacingHorizontalS,
    alignItems: 'baseline',
    width: '100%',
    boxSizing: 'border-box',
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    border: 'none',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    backgroundColor: 'transparent',
    color: 'inherit',
    font: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
    ':hover': { backgroundColor: tokens.colorSubtleBackgroundHover },
  },
  logRowOpen: { backgroundColor: tokens.colorNeutralBackground2 },
  details: {
    margin: `0 ${tokens.spacingHorizontalM} ${tokens.spacingVerticalS}`,
    padding: tokens.spacingVerticalS,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    fontSize: tokens.fontSizeBase200,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
  },
  detailRow: { display: 'flex', justifyContent: 'space-between', gap: tokens.spacingHorizontalM },
  indent: { paddingLeft: tokens.spacingHorizontalL },
})

const plural = (n: number, one: string, many: string, locale?: string) => `${n.toLocaleString(locale)} ${n === 1 ? one : many}`

/** Settings › Sync: how current this device is, whether changes arrive by themselves, what is stuck, and what happened in recent syncs. */
export function SyncSettings() {
  const styles = useStyles()
  const { db, engine } = useServices()
  const { status, sync, now } = useSyncDescription()
  const syncing = sync.kind === 'syncing'

  const waiting = useLiveQuery(async () => {
    const ops = await db.outbox.orderBy('seq').toArray()
    return { count: ops.length, failing: ops.find((o) => o.attempts > 0)?.lastError ?? null }
  }, [db])
  const counts = useLiveQuery(
    async () => ({
      lists: await db.lists.count(),
      open: await db.tasks.where('completed').equals(0).count(),
      done: await db.tasks.where('completed').equals(1).count(),
    }),
    [db],
  )
  const log = useLiveQuery(() => db.syncLog.orderBy('id').reverse().toArray(), [db])

  return (
    <div className={styles.section}>
      <Subtitle2>Sync</Subtitle2>

      <div className={styles.row}>
        <span className={mergeClasses(styles.icon, sync.kind === 'error' && styles.iconError)}><RestingIcon kind={sync.kind} /></span>
        <div>
          <Body1>
            <b>{syncing ? `${sync.label}${sync.detail ? ` (${sync.detail})` : ''}` : sync.label}</b>
          </Body1>
          <Caption1 className={styles.muted}>{statusLine(status, now)}</Caption1>
        </div>
      </div>

      <LiveUpdatesRow />

      <div>
        <Body1>
          <b>
            {waiting && waiting.count > 0
              ? `${plural(waiting.count, 'change', 'changes')} waiting to be sent`
              : 'Nothing waiting to be sent'}
          </b>
        </Body1>
        {waiting?.failing && <Caption1 className={mergeClasses(styles.muted, styles.error)}>{waiting.failing}</Caption1>}
      </div>

      {counts && (
        <Caption1 className={styles.muted}>
          {`On this ${isNative ? 'phone' : 'device'}: ${plural(counts.lists, 'list', 'lists')} · ${plural(counts.open, 'open task', 'open tasks')} · ${counts.done.toLocaleString()} completed`}
        </Caption1>
      )}

      <div className={styles.buttons}>
        <Button appearance="primary" disabled={syncing} onClick={() => void engine.sync({ reason: 'manual' })}>
          Sync now
        </Button>
        <Button appearance="secondary" disabled={syncing} onClick={() => void engine.sync({ reason: 'manual-full' })}>
          Check everything
        </Button>
      </div>

      <Subtitle2 style={{ marginTop: tokens.spacingVerticalM }}>Recent syncs</Subtitle2>
      <div className={styles.log}>
        {log?.length === 0 && <Caption1 style={{ padding: tokens.spacingVerticalM, display: 'block' }}>No syncs yet.</Caption1>}
        {log?.map((entry) => <LogRow key={entry.id} entry={entry} now={now} />)}
      </div>
      <Caption1 className={styles.muted}>Kept on this device: the last 100 syncs.</Caption1>
    </div>
  )
}

function LiveUpdatesRow() {
  const styles = useStyles()
  const live = useLiveUpdates()
  const dot = live.state === 'on' ? styles.dotOn : live.state === 'off' ? styles.dotOff : styles.dotNone
  const title = live.state === 'on' ? 'Live updates on' : live.state === 'off' ? 'Live updates off' : 'Live updates not available'
  return (
    <div>
      <Body1>
        <span className={mergeClasses(styles.dot, dot)} aria-hidden="true" />
        <b>{title}</b>
      </Body1>
      <Caption1 className={styles.muted}>
        {live.state === 'on'
          ? 'Changes made elsewhere arrive within seconds.'
          : `${live.state === 'off' && live.reason ? `${live.reason} ` : ''}Checks every 5 minutes while open instead.`}
      </Caption1>
    </div>
  )
}

function LogRow({ entry, now }: { entry: SyncLogEntry; now: number }) {
  const styles = useStyles()
  const [open, setOpen] = useState(false)
  const failed = entry.result !== 'ok'
  return (
    <div>
      <button
        type="button"
        className={mergeClasses(styles.logRow, open && styles.logRowOpen)}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Caption1 className={styles.muted}>{formatWhen(entry.startedAt, now)}</Caption1>
        <span>
          <span className={failed ? styles.error : undefined}>{logSummary(entry)}</span>
          <Caption1 className={styles.muted}>{reasonText(entry)}</Caption1>
        </span>
        <Caption1 className={styles.muted}>{durationText(entry.endedAt - entry.startedAt)}</Caption1>
      </button>
      {open && (
        <div className={styles.details}>
          {logDetails(entry).map((row) => (
            <div key={row.text} className={mergeClasses(styles.detailRow, row.indent && styles.indent, row.tone === 'error' && styles.error)}>
              <span>{row.text}</span>
              {row.value !== undefined && <span className={styles.muted}>{row.value}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

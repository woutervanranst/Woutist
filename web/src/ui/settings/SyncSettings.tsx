import { Body1, Button, Caption1, Link, Subtitle2, makeStyles, mergeClasses, tokens } from '@fluentui/react-components'
import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useServices } from '../../app/AppServices'
import { isNative } from '../../platform/native'
import { RestingIcon } from '../shell/SyncIcons'
import { useLiveUpdates, useSyncDescription } from '../hooks'
import { statusLine } from '../syncText'
import { RecentSyncsDialog } from './RecentSyncsDialog'

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
})

const plural = (n: number, one: string, many: string, locale?: string) => `${n.toLocaleString(locale)} ${n === 1 ? one : many}`

/** Settings › Sync: how current this device is, whether changes arrive by themselves, what is stuck, and a link to what happened in recent syncs. */
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
  const [logOpen, setLogOpen] = useState(false)

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

      <div>
        <Link as="button" onClick={() => setLogOpen(true)}>
          Recent syncs
        </Link>
      </div>
      {logOpen && <RecentSyncsDialog onClose={() => setLogOpen(false)} />}
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

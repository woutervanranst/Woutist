import {
  Button,
  Caption1,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components'
import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useServices } from '../../app/AppServices'
import { SYNC_LOG_RETENTION_MS, type SyncLogEntry } from '../../services/sync/syncTypes'
import {
  durationText,
  formatWhen,
  groupDurations,
  groupReasons,
  groupSyncLog,
  groupTimeRange,
  logDetails,
  logSummary,
  reasonText,
  type LogGroup,
} from '../syncText'

const useStyles = makeStyles({
  log: { border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium, overflow: 'hidden', marginTop: tokens.spacingVerticalS },
  empty: { padding: tokens.spacingVerticalM, display: 'block' },
  row: {
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
  rowOpen: { backgroundColor: tokens.colorNeutralBackground2 },
  muted: { color: tokens.colorNeutralForeground3, display: 'block' },
  error: { color: tokens.colorPaletteRedForeground1 },
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
  runLine: { color: tokens.colorNeutralForeground2, overflowWrap: 'anywhere' },
})

/** The sync log in its own dialog (over Settings): the last 24 hours, newest first, similar runs combined. Mount it to open it. */
export function RecentSyncsDialog({ onClose }: { onClose: () => void }) {
  const styles = useStyles()
  const { db } = useServices()
  const log = useLiveQuery(async () => {
    const now = Date.now()
    const entries = await db.syncLog.where('startedAt').aboveOrEqual(now - SYNC_LOG_RETENTION_MS).toArray()
    return { now, items: groupSyncLog(entries, now) }
  }, [db])

  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 480 }}>
        <DialogBody>
          <DialogTitle>Recent syncs</DialogTitle>
          <DialogContent>
            <Caption1 className={styles.muted}>Syncs from the last 24 hours, kept on this device.</Caption1>
            {log && (
              <div className={styles.log}>
                {log.items.length === 0 && <Caption1 className={styles.empty}>No syncs in the last 24 hours.</Caption1>}
                {log.items.map((item) =>
                  item.kind === 'single' ? (
                    <LogRow key={item.entry.id} entry={item.entry} now={log.now} />
                  ) : (
                    <GroupRow key={item.entries[0]!.id} group={item} now={log.now} />
                  ),
                )}
              </div>
            )}
          </DialogContent>
          <DialogActions>
            <DialogTrigger disableButtonEnhancement action="close">
              <Button appearance="primary">Close</Button>
            </DialogTrigger>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}

function LogRow({ entry, now }: { entry: SyncLogEntry; now: number }) {
  const styles = useStyles()
  const [open, setOpen] = useState(false)
  const failed = entry.result !== 'ok'
  return (
    <div>
      <button type="button" className={mergeClasses(styles.row, open && styles.rowOpen)} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
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

function GroupRow({ group, now }: { group: LogGroup; now: number }) {
  const styles = useStyles()
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button type="button" className={mergeClasses(styles.row, open && styles.rowOpen)} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Caption1 className={styles.muted}>{groupTimeRange(group, now)}</Caption1>
        <span>
          <span className={group.failed ? styles.error : undefined}>{`${group.summary} · ${group.entries.length} syncs`}</span>
          <Caption1 className={styles.muted}>{groupReasons(group)}</Caption1>
        </span>
        <Caption1 className={styles.muted}>{groupDurations(group)}</Caption1>
      </button>
      {open && (
        <div className={styles.details}>
          {group.entries.map((entry) => (
            <Caption1 key={entry.id} data-testid="group-run" className={styles.runLine}>
              {`${formatWhen(entry.startedAt, now)} · ${reasonText(entry)} · ${durationText(entry.endedAt - entry.startedAt)}`}
            </Caption1>
          ))}
        </div>
      )}
    </div>
  )
}

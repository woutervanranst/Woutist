import {
  Button,
  Link,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Text,
  Toast,
  ToastTitle,
  Tooltip,
  makeStyles,
  tokens,
  useToastController,
} from '@fluentui/react-components'
import { useState } from 'react'
import { useServices } from '../../app/AppServices'
import { useSyncDescription } from '../hooks'
import { manualToast } from '../syncText'
import { RestingIcon, SyncRing } from './SyncIcons'

const useStyles = makeStyles({
  button: { color: tokens.colorNeutralForegroundOnBrand, minWidth: '32px', flexShrink: 0 },
  popover: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS, alignItems: 'flex-start' },
})

/**
 * The header's sync icon. Resting, it only claims what it knows (see `describeSync`). While syncing it is a
 * progress ring, and a tap says what is running (it never starts or queues anything). Otherwise a tap syncs,
 * and a toast says what that found.
 */
export function SyncIndicator({ onDetails }: { onDetails: () => void }) {
  const styles = useStyles()
  const { engine } = useServices()
  const { status, sync } = useSyncDescription()
  const { dispatchToast } = useToastController('app')
  const [popoverOpen, setPopoverOpen] = useState(false)
  const syncing = sync.kind === 'syncing'

  const tapToSync = async () => {
    const outcome = await engine.sync({ reason: 'manual' })
    const text = manualToast(outcome)
    if (!text) return
    dispatchToast(
      <Toast>
        <ToastTitle>{text}</ToastTitle>
      </Toast>,
      { intent: outcome.result === 'ok' ? 'success' : 'warning' },
    )
  }

  const label = sync.detail ? `${sync.label} ${sync.detail}` : sync.label
  return (
    <Popover
      open={popoverOpen && syncing}
      onOpenChange={(_, data) => setPopoverOpen(data.open && syncing)}
      positioning="below-end"
    >
      <Tooltip content={label} relationship="label">
        <PopoverTrigger disableButtonEnhancement>
          <Button
            appearance="transparent"
            className={styles.button}
            icon={syncing ? <SyncRing progress={status.progress} /> : <RestingIcon kind={sync.kind} />}
            onClick={syncing ? undefined : () => void tapToSync()}
          />
        </PopoverTrigger>
      </Tooltip>
      <PopoverSurface>
        <div className={styles.popover}>
          <Text>{sync.detail ?? 'Syncing…'}</Text>
          <Link
            as="button"
            onClick={() => {
              setPopoverOpen(false)
              onDetails()
            }}
          >
            Details
          </Link>
        </div>
      </PopoverSurface>
    </Popover>
  )
}

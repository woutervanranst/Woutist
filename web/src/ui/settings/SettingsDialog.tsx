import {
  Button,
  Caption1,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Divider,
  Field,
  Radio,
  RadioGroup,
  Subtitle2,
  Switch,
  makeStyles,
  tokens,
} from '@fluentui/react-components'
import type { ReactNode } from 'react'
import { useServices } from '../../app/AppServices'
import type { ThemePref } from '../../app/prefs'
import { SMART_LISTS } from '../../models/views'
import { useAccountPrefs } from '../hooks'
import { CategorySettings } from './CategorySettings'
import { DateReminderSettings } from './DateReminderSettings'

const useStyles = makeStyles({
  section: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS, marginBottom: tokens.spacingVerticalL },
})

interface Props {
  open: boolean
  onClose: () => void
  /** Extra sections (notifications) contributed by other modules. */
  extra?: ReactNode
}

export function SettingsDialog({ open, onClose, extra }: Props) {
  const styles = useStyles()
  const [prefs, update] = useAccountPrefs()
  const { engine } = useServices()

  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 480 }}>
        <DialogBody>
          <DialogTitle>Settings</DialogTitle>
          <DialogContent>
            <div className={styles.section}>
              <Subtitle2>Appearance</Subtitle2>
              <Field label="Theme">
                <RadioGroup
                  layout="horizontal"
                  value={prefs.theme}
                  onChange={(_, d) => update((p) => ({ ...p, theme: d.value as ThemePref }))}
                >
                  <Radio value="system" label="System" />
                  <Radio value="light" label="Light" />
                  <Radio value="dark" label="Dark" />
                </RadioGroup>
              </Field>
            </div>
            <Divider />
            <DateReminderSettings />
            <Divider />
            <div className={styles.section} style={{ marginTop: 16 }}>
              <Subtitle2>Smart lists</Subtitle2>
              {SMART_LISTS.map((s) => (
                <Switch
                  key={s.id}
                  label={s.label}
                  checked={prefs.smartLists[s.id]}
                  onChange={(_, d) =>
                    update((p) => ({ ...p, smartLists: { ...p.smartLists, [s.id]: d.checked } }))
                  }
                />
              ))}
            </div>
            <Divider />
            <CategorySettings />
            <Divider />
            <div className={styles.section} style={{ marginTop: 16 }}>
              <Subtitle2>General</Subtitle2>
              <Switch
                label="Confirm before deleting"
                checked={prefs.confirmDelete}
                onChange={(_, d) => update((p) => ({ ...p, confirmDelete: d.checked }))}
              />
              <Button appearance="secondary" onClick={() => void engine.sync({ full: true })}>
                Sync everything now
              </Button>
            </div>
            {extra}
            <Divider />
            <Caption1 style={{ display: 'block', marginTop: 12 }}>
              Woutist {__APP_VERSION__}. Your tasks live in Microsoft To Do; Woutist only keeps an offline
              copy on this device.
            </Caption1>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={onClose}>
              Done
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}

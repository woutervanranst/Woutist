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
  Select,
  Subtitle2,
  Switch,
  makeStyles,
  tokens,
} from '@fluentui/react-components'
import { type ReactNode, useCallback } from 'react'
import type { ThemePref } from '../../app/prefs'
import { SMART_LISTS, normalizeStartPage } from '../../models/views'
import { useAccountPrefs, useStartPage } from '../hooks'
import { CategorySettings } from './CategorySettings'
import { DateReminderSettings } from './DateReminderSettings'
import { SyncSettings } from './SyncSettings'

const useStyles = makeStyles({
  section: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS, marginBottom: tokens.spacingVerticalL },
})

interface Props {
  open: boolean
  onClose: () => void
  /** Extra sections (notifications) contributed by other modules. */
  extra?: ReactNode
  /** Open scrolled to this section (the sync icon's Details link). */
  scrollTo?: 'sync' | null | undefined
}

export function SettingsDialog({ open, onClose, extra, scrollTo }: Props) {
  const styles = useStyles()
  const [prefs, update] = useAccountPrefs()
  const [startPage, setStartPage] = useStartPage()
  // A callback ref: the dialog's content mounts a moment after `open` turns true.
  const syncSection = useCallback(
    (element: HTMLDivElement | null) => {
      if (element && scrollTo === 'sync') element.scrollIntoView?.({ block: 'start' })
    },
    [scrollTo],
  )

  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 480 }}>
        <DialogBody>
          <DialogTitle>Settings</DialogTitle>
          <DialogContent>
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
              <Field label="Open the app on" hint="Used on all your devices.">
                <Select value={startPage} onChange={(_, d) => setStartPage(normalizeStartPage(d.value))}>
                  <option value="tasks">Tasks</option>
                  {SMART_LISTS.filter((s) => prefs.smartLists[s.id] || s.id === startPage).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Switch
                label="Confirm before deleting"
                checked={prefs.confirmDelete}
                onChange={(_, d) => update((p) => ({ ...p, confirmDelete: d.checked }))}
              />
            </div>
            <Divider />
            <div ref={syncSection} style={{ marginTop: 16 }}>
              <SyncSettings />
            </div>
            {extra}
            <Divider />
            <div className={styles.section} style={{ marginTop: 16 }}>
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

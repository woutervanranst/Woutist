import {
  Body1,
  Button,
  Caption1,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Subtitle2,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components'
import { AddRegular, DeleteRegular, EditRegular } from '@fluentui/react-icons'
import { useEffect, useState } from 'react'
import { useServices } from '../../app/AppServices'
import type { CategoryRecord } from '../../services/db'
import { PRESET_KEYS, categoryColor } from '../common/categoryColors'
import { ConfirmDialog } from '../common/ConfirmDialog'
import { useCategories } from '../hooks'

const useStyles = makeStyles({
  section: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS, margin: `${tokens.spacingVerticalM} 0 ${tokens.spacingVerticalL}` },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  row: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS },
  name: { flexGrow: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  dot: { width: '12px', height: '12px', borderRadius: '50%', flexShrink: 0 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: tokens.spacingHorizontalS },
  swatch: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    border: `2px solid transparent`,
    cursor: 'pointer',
    padding: 0,
    justifySelf: 'center',
  },
  swatchSelected: { border: `2px solid ${tokens.colorNeutralForeground1}`, outline: `2px solid ${tokens.colorNeutralBackground1}`, outlineOffset: '-4px' },
  error: { color: tokens.colorPaletteRedForeground1 },
})

/** Settings > Categories: create, recolor, rename and delete your Outlook categories. */
export function CategorySettings() {
  const styles = useStyles()
  const { categories: service } = useServices()
  const categories = useCategories()
  const [editing, setEditing] = useState<CategoryRecord | 'new' | null>(null)
  const [deleting, setDeleting] = useState<{ category: CategoryRecord; tasks: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Fills in ids on rows cached by an older version; failures just leave the cached list.
  useEffect(() => {
    void service.refresh().catch(() => {})
  }, [service])

  async function askDelete(category: CategoryRecord) {
    setError(null)
    setDeleting({ category, tasks: await service.usage(category.displayName) })
  }

  async function confirmDelete() {
    const target = deleting
    setDeleting(null)
    if (!target) return
    try {
      await service.remove(target.category)
    } catch (e) {
      setError(describe(e))
    }
  }

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <Subtitle2>Categories</Subtitle2>
        <Button size="small" icon={<AddRegular />} onClick={() => setEditing('new')}>
          New category
        </Button>
      </div>
      {categories.length === 0 && <Caption1>No categories yet.</Caption1>}
      {categories.map((c) => (
        <div key={c.displayName} className={styles.row}>
          <span className={styles.dot} style={{ backgroundColor: categoryColor(c.color) }} />
          <Body1 className={styles.name}>{c.displayName}</Body1>
          <Button
            appearance="subtle"
            size="small"
            icon={<EditRegular />}
            aria-label={`Edit ${c.displayName}`}
            onClick={() => {
              setError(null)
              setEditing(c)
            }}
          />
          <Button
            appearance="subtle"
            size="small"
            icon={<DeleteRegular />}
            aria-label={`Delete ${c.displayName}`}
            onClick={() => void askDelete(c)}
          />
        </div>
      ))}
      {error && <Caption1 className={styles.error}>{error}</Caption1>}
      {editing && <CategoryDialog category={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={deleting !== null}
        title="Delete category"
        message={
          deleting
            ? `Delete "${deleting.category.displayName}"? ${
                deleting.tasks === 0
                  ? 'No tasks use it.'
                  : `It will be removed from ${deleting.tasks} ${deleting.tasks === 1 ? 'task' : 'tasks'}.`
              }`
            : ''
        }
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </div>
  )
}

function CategoryDialog({ category, onClose }: { category: CategoryRecord | null; onClose: () => void }) {
  const styles = useStyles()
  const { categories: service } = useServices()
  const [name, setName] = useState(category?.displayName ?? '')
  const [color, setColor] = useState(category?.color && category.color !== 'none' ? category.color : PRESET_KEYS[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const changed = !category || name.trim() !== category.displayName || color !== category.color

  async function save() {
    setBusy(true)
    setError(null)
    try {
      if (category) await service.edit(category, { name, color })
      else await service.create(name, color)
      onClose()
    } catch (e) {
      setError(describe(e))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(_, d) => !d.open && !busy && onClose()}>
      <DialogSurface style={{ maxWidth: 400 }}>
        <DialogBody>
          <DialogTitle>{category ? 'Edit category' : 'New category'}</DialogTitle>
          <DialogContent>
            <Field label="Name" validationMessage={error ?? undefined} validationState={error ? 'error' : 'none'}>
              <Input autoFocus value={name} onChange={(_, d) => setName(d.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && changed && !busy && void save()} />
            </Field>
            <Field label="Color" style={{ marginTop: 12 }}>
              <div className={styles.grid} role="radiogroup" aria-label="Color">
                {PRESET_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={color === key}
                    aria-label={key}
                    className={mergeClasses(styles.swatch, color === key && styles.swatchSelected)}
                    style={{ backgroundColor: categoryColor(key) }}
                    onClick={() => setColor(key)}
                  />
                ))}
              </div>
            </Field>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button appearance="primary" disabled={busy || !name.trim() || !changed} onClick={() => void save()}>
              Save
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}

function describe(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Something went wrong. Try again.'
}

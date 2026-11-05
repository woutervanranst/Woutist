import { Menu, MenuDivider, MenuItem, MenuList, MenuPopover, MenuTrigger } from '@fluentui/react-components'
import { type ReactElement, useState } from 'react'
import { useServices } from '../../app/AppServices'
import { type RepeatPreset, buildRecurrence, recurrencePreset } from '../../models/presets'
import { todayLocal } from '../../models/time'
import type { Task } from '../../models/todo'
import { CustomRepeatDialog } from '../taskDetail/pickers'

const REPEAT_LABELS: Record<RepeatPreset, string> = {
  daily: 'Daily',
  weekdays: 'Weekdays',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
}

/** The repeat options, opened from `children` (the trigger). Repeats are anchored on the due date. */
export function RepeatMenu({ task, children }: { task: Task; children: ReactElement }) {
  const { repo } = useServices()
  const [custom, setCustom] = useState(false)
  const anchor = task.dueDate ?? todayLocal()
  const current = recurrencePreset(task.recurrence)
  const update = (changes: Parameters<typeof repo.updateTask>[1]) => void repo.updateTask(task.id, changes)
  return (
    <>
      <Menu>
        <MenuTrigger disableButtonEnhancement>{children}</MenuTrigger>
        <MenuPopover>
          <MenuList>
            {(Object.keys(REPEAT_LABELS) as RepeatPreset[]).map((p) => (
              <MenuItem key={p} onClick={() => update({ recurrence: buildRecurrence(p, anchor), dueDate: anchor })}>
                {REPEAT_LABELS[p]}
                {current === p ? ' ✓' : ''}
              </MenuItem>
            ))}
            <MenuDivider />
            <MenuItem onClick={() => setCustom(true)}>Custom…{current === 'custom' ? ' ✓' : ''}</MenuItem>
            {task.recurrence && <MenuItem onClick={() => update({ recurrence: null })}>Don't repeat</MenuItem>}
          </MenuList>
        </MenuPopover>
      </Menu>
      {custom && (
        <CustomRepeatDialog
          open
          onSave={(r) => update({ recurrence: buildRecurrence(r, anchor), dueDate: anchor })}
          onClose={() => setCustom(false)}
        />
      )}
    </>
  )
}

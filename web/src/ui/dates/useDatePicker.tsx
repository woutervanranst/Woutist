import type { PositioningVirtualElement } from '@fluentui/react-components'
import { type ReactNode, useCallback, useState } from 'react'
import type { Task } from '../../models/todo'
import { DateReminderPopover } from './DateReminderPicker'
import { DateReminderSheet } from './DateReminderSheet'
import type { DateEditor } from './useDateEditor'

/** A fixed positioning target: a point (where the right-click menu was) or an element's rect at open time. */
function fixedTarget(rect: { x: number; y: number; width?: number; height?: number }): PositioningVirtualElement {
  const r = new DOMRect(rect.x, rect.y, rect.width ?? 0, rect.height ?? 0)
  return { getBoundingClientRect: () => r } as PositioningVirtualElement
}

export interface DatePicker {
  /** Open next to an element or at a point. The picker stays put if the element moves (re-sorted lists). */
  open: (from: Element | { x: number; y: number }, options?: { calendar?: boolean }) => void
  /** Render this somewhere: the open picker (a popover, or a bottom sheet in compact layouts). */
  element: ReactNode
}

export function useDatePicker(task: Task, editor: DateEditor, compact: boolean): DatePicker {
  const [state, setState] = useState<{ target: PositioningVirtualElement; calendar: boolean } | null>(null)

  const open = useCallback<DatePicker['open']>((from, options) => {
    const target = fixedTarget(from instanceof Element ? from.getBoundingClientRect() : from)
    setState({ target, calendar: Boolean(options?.calendar) })
  }, [])

  const close = () => {
    setState(null)
    editor.end()
  }

  const element = state ? (
    compact ? (
      <DateReminderSheet task={task} editor={editor} calendarOpen={state.calendar} onClose={close} />
    ) : (
      <DateReminderPopover task={task} editor={editor} target={state.target} calendarOpen={state.calendar} onClose={close} />
    )
  ) : null

  return { open, element }
}

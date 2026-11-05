import { formatFullDate, reminderLabel, reminderWall } from '../../models/dateReminder'
import { type QuickDateOption, quickDateOptions } from '../../models/quickDates'
import { todayLocal } from '../../models/time'
import type { Task } from '../../models/todo'
import { useDateSettings } from '../hooks'

/** What the date controls show for a task: its quick dates, labels and current reminder time. */
export function useDateView(task: Task) {
  const [settings] = useDateSettings()
  const today = todayLocal()
  const reminder = reminderWall(task)
  const options = quickDateOptions(settings, today)
  return {
    today,
    settings,
    options,
    reminderTime: reminder?.time ?? null,
    reminderLabel: reminderLabel(task, today),
    day: Number(today.slice(8)),
    /** Where the reminder will go: "on Thu, Nov 5" or, without a date, today. */
    remindHint: task.dueDate ? `on ${formatFullDate(task.dueDate, today)}` : 'sets the date to today',
    isPicked: (o: QuickDateOption) => task.dueDate === o.value,
  }
}

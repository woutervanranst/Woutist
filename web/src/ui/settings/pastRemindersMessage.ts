export const PAST_REMINDERS_HINT =
  'Lost your reminder notifications (a restart, an update, an accidental swipe)? This notifies you again for every open task whose reminder time has passed.'

export function pastRemindersMessage(count: number): string {
  if (count === 0) return 'No reminders have come due for your open tasks.'
  return count === 1 ? 'Showed 1 reminder.' : `Showed ${count} reminders.`
}

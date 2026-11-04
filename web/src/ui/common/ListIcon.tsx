import { AppsListRegular } from '@fluentui/react-icons/svg/apps-list'
import { CheckmarkCircleRegular } from '@fluentui/react-icons/svg/checkmark-circle'
import { CalendarLtrRegular } from '@fluentui/react-icons/svg/calendar-ltr'
import { FlagRegular } from '@fluentui/react-icons/svg/flag'
import { HomeRegular } from '@fluentui/react-icons/svg/home'
import { ListRegular } from '@fluentui/react-icons/svg/list'
import { SearchRegular } from '@fluentui/react-icons/svg/search'
import { StarRegular } from '@fluentui/react-icons/svg/star'
import type { TodoList } from '../../models/todo'
import { type SmartListId, splitListEmoji } from '../../models/views'

export const SMART_ICONS: Record<SmartListId, typeof StarRegular> = {
  important: StarRegular,
  planned: CalendarLtrRegular,
  all: AppsListRegular,
  completed: CheckmarkCircleRegular,
}

export function SmartListIcon({ id }: { id: SmartListId | 'search' }) {
  const Icon = id === 'search' ? SearchRegular : SMART_ICONS[id]
  return <Icon fontSize={20} />
}

export function ListIcon({ list }: { list: TodoList }) {
  if (list.wellknownListName === 'defaultList') return <HomeRegular fontSize={20} />
  if (list.wellknownListName === 'flaggedEmails') return <FlagRegular fontSize={20} />
  const { emoji } = splitListEmoji(list.displayName)
  if (emoji) return <span style={{ fontSize: 18, lineHeight: '20px', width: 20, textAlign: 'center' }}>{emoji}</span>
  return <ListRegular fontSize={20} />
}

export function listLabel(list: TodoList): string {
  return splitListEmoji(list.displayName).label
}

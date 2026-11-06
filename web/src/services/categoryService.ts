import { graphStatus } from './graphClient'
import type { CategoryRecord, WoutistDb } from './db'
import type { TodoRepository } from './repository'
import type { SyncEngine } from './sync/syncEngine'
import type { TaskService } from './taskService'

export class CategoryError extends Error {}

interface Deps {
  svc: TaskService
  engine: SyncEngine
  repo: TodoRepository
  db: WoutistDb
}

/** Statuses Graph uses to say "you can't change that property". */
const REFUSED = [400, 405, 422, 501]

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()

/**
 * Create, recolor, rename and delete Outlook master categories (Settings > Categories).
 *
 * The category writes go straight to Graph (online only: they're rare, and a failure should show
 * up in the dialog, not in a queue). Tasks carry category names as plain strings, so a rename or a
 * delete also rewrites the affected tasks; those edits use the normal outbox and work offline.
 */
export class CategoryService {
  private readonly deps: Deps

  constructor(deps: Deps) {
    this.deps = deps
  }

  /** Reload the master list from Graph (also fills in ids on rows cached by an older version). */
  refresh(): Promise<void> {
    return this.deps.engine.pullCategories()
  }

  async create(name: string, color: string): Promise<void> {
    const displayName = await this.validName(name)
    const created = await this.deps.svc.createCategory(displayName, color)
    await this.deps.db.categories.put({ id: created.id, displayName: created.displayName ?? displayName, color: created.color ?? color })
  }

  async recolor(category: CategoryRecord, color: string): Promise<void> {
    const id = this.idOf(category)
    const updated = await this.deps.svc.updateCategory(id, { color })
    await this.deps.db.categories.put({ ...category, color: updated.color ?? color })
  }

  /** Rename and/or recolor in one go. Tasks that carry the old name are re-tagged. */
  async edit(category: CategoryRecord, changes: { name: string; color: string }): Promise<void> {
    let current = category
    if (changes.name.trim() !== category.displayName) current = await this.rename(category, changes.name)
    if (changes.color !== current.color) await this.recolor(current, changes.color)
  }

  async rename(category: CategoryRecord, newName: string): Promise<CategoryRecord> {
    const { svc, db } = this.deps
    const id = this.idOf(category)
    const oldName = category.displayName
    const displayName = await this.validName(newName, category)
    if (displayName === oldName) return category

    // Graph documents displayName as read-only. Seen on a live account: PATCH answers 200 and quietly
    // keeps the old name. So only believe a rename when the name that comes back is the one we sent.
    try {
      const updated = await svc.updateCategory(id, { displayName })
      if (updated.displayName === displayName) {
        const renamed = { id: updated.id ?? id, displayName, color: updated.color ?? category.color }
        await db.categories.delete(oldName)
        await db.categories.put(renamed)
        await this.retag(oldName, displayName)
        return renamed
      }
    } catch (error) {
      if (!REFUSED.includes(graphStatus(error) ?? 0)) throw error
    }

    // Not renamed in place: create the new category, move the tasks over, delete the old one.
    const created = await svc.createCategory(displayName, category.color)
    const renamed = { id: created.id, displayName: created.displayName ?? displayName, color: created.color ?? category.color }
    await db.categories.put(renamed)
    await this.retag(oldName, displayName)
    await svc.deleteCategory(id)
    await db.categories.delete(oldName)
    return renamed
  }

  /** How many tasks carry this category (for the delete confirmation). */
  async usage(name: string): Promise<number> {
    return this.deps.db.tasks.filter((t) => t.categories.includes(name)).count()
  }

  /** Delete the category and take its name off every task that has it. Returns the task count. */
  async remove(category: CategoryRecord): Promise<number> {
    const { svc, db } = this.deps
    const id = this.idOf(category)
    await svc.deleteCategory(id)
    await db.categories.delete(category.displayName)
    return this.retag(category.displayName, null)
  }

  /** Replace `from` with `to` (or drop it when `to` is null) on all tasks. */
  private async retag(from: string, to: string | null): Promise<number> {
    const { db, repo } = this.deps
    const tasks = await db.tasks.filter((t) => t.categories.includes(from)).toArray()
    for (const task of tasks) {
      const next = task.categories.flatMap((c) => (c === from ? (to === null ? [] : [to]) : [c]))
      await repo.updateTask(task.id, { categories: [...new Set(next)] })
    }
    return tasks.length
  }

  private idOf(category: CategoryRecord): string {
    if (!category.id) throw new CategoryError('This category is not synced yet. Reopen Settings and try again.')
    return category.id
  }

  private async validName(name: string, except?: CategoryRecord): Promise<string> {
    const trimmed = name.trim()
    if (!trimmed) throw new CategoryError('Category name is required')
    const all = await this.deps.db.categories.toArray()
    if (all.some((c) => c.displayName !== except?.displayName && sameName(c.displayName, trimmed))) {
      throw new CategoryError(`A category named "${trimmed}" already exists`)
    }
    return trimmed
  }
}

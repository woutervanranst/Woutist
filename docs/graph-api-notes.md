# Microsoft Graph To Do API: verified behaviour

Checked against the live API (v1.0) with a personal Microsoft account on 2026-11-04. You can re-run the spike from the dev console after signing in on `localhost:5173`: `await __woutist.spike()`. It creates a temporary list and deletes it afterwards.

| Topic | Result | How Woutist uses it |
|---|---|---|
| Writing `dueDateTime` / `reminderDateTime` with an **IANA zone** (`Europe/Brussels`) | Accepted. Stored and returned **in UTC by default** (`2026-11-05T23:00:00`, `UTC`) | Writes local wall time + IANA zone |
| Reading with `Prefer: outlook.timezone="Europe/Brussels"` | Returned in that zone (`2026-11-06T00:00:00`, `Europe/Brussels`) | Every read sends the browser's zone. Due date = date part. UTC values from other clients are converted |
| `GET …/tasks?$expand=checklistItems,linkedResources` | Steps included. **Empty collections are omitted** (no key) | Mappers default missing collections to `[]` |
| `GET …/tasks/delta?$expand=checklistItems,linkedResources` | Works. **The deltaLink keeps the `$expand`**, so changed tasks arrive with their steps | Initial sync = one delta round. Incremental = apply delta items directly |
| Delta after adding/checking a step | The task is reported as changed | No separate step polling needed |
| Delta pagination | The first response can carry only `@odata.nextLink`. The deltaLink comes on the last page | `TaskService.collect()` follows `nextLink` |
| Completing a **recurring** task | The **original id stays open** with the next due date (+1 interval). A **new completed copy** with a new id is created. Delta reports both | Nothing special: the next sync shows the same result as the official app |
| `wellknownListName` values | `defaultList` for *Tasks*. No `flaggedEmails` list unless the mailbox has one | Flagged email shown only when present |
| Small attachments (`taskFileAttachment`, base64) | 201. Listing with `$select` returns metadata | Upload sessions are used above 3 MB |
| `/me/outlook/masterCategories` (personal account) | 200 | Category names + colors |
| `/me/photo/$value` without a photo | 404 | Initials avatar |
| `/me/todo/lists/delta` | Works | Not needed: lists are read in full (one cheap request) |

**Not available in Graph:** My Day, list groups (folders), manual task order, "Assigned to me" (Planner), sharing management.

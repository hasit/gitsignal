# Next Steps (Design)

## Repo Watch List + Notification Management

### Goal
Let users control which repositories and notification types GitSignal surfaces, and (optionally) sync those choices with GitHub “Watch” settings.

### Phase 1 (Local-only, no extra token scopes)
- Add a **Repo allow/deny list** that filters the notification feed locally.
- UI: Settings → **Repositories**
  - Search + add repo by `owner/name`
  - Toggle: “Only show notifications from these repos” (allow list mode)
  - Toggle: “Hide notifications from these repos” (deny list mode)

### Phase 2 (Sync with GitHub watch settings)
Requires additional classic PAT scopes for private repos (likely `repo`).

- List watched repos:
  - `GET /user/subscriptions`
- Watch/unwatch a repo:
  - `PUT /repos/{owner}/{repo}/subscription`
  - `DELETE /repos/{owner}/{repo}/subscription`
- UI:
  - “Sync watched repos from GitHub”
  - “Watch / Unwatch” buttons per repo
  - Clear error messaging when token scopes are insufficient (403)

### Phase 3 (Thread-level controls)
- Mute/subscribe per notification thread:
  - `PUT /notifications/threads/{thread_id}/subscription`
  - `DELETE /notifications/threads/{thread_id}/subscription`
- UI:
  - Per-notification actions: “Mute thread”, “Subscribe”, “Ignore”

### Storage
- Persist user preferences (repo allow/deny list, sync toggle) alongside other app settings.
- Suggested location: main process `electron-store` (same mechanism as app preferences).

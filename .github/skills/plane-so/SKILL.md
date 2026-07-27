# Plane.so Work Item Management Skill

Domain knowledge for interacting with the Plane.so API to manage work items in the `fincoach` workspace/project.

---

## Connection Details

| Setting | Value |
|---------|-------|
| Base URL (issues, states, labels, cycle members) | `https://api.plane.so/api/v1` |
| Base URL (cycle CRUD) | `https://api.plane.so/api/v2` |
| Auth header | `X-API-Key: $PLANE_TOKEN` |
| Workspace slug | `fincoach` |
| Workspace ID | `d18e46e2-27d7-4111-8ad5-5b338d6f9448` |
| Project name | `fincoach` |
| Project ID | `149b50b7-96ae-4caa-8e46-b41d0a3869d6` |

The `PLANE_TOKEN` environment variable is set in `~/.bashrc` (loaded in the shell profile).

**Always read the token from the environment — never hardcode it.**

> **API version note**: Work items, states, labels, and adding issues to cycles use `/api/v1`.
> Creating, updating, and deleting **cycles themselves** requires `/api/v2` — the v1 endpoint returns `"Project ID is required"` regardless of the body.

---

## Authentication

All requests require the header:
```
X-API-Key: $PLANE_TOKEN
```

---

## Known States (fincoach project)

| Name | ID | Group |
|------|-----|-------|
| Backlog | `ddad386f-9025-46e6-b2bc-010acad70dae` | backlog |
| Todo | `665b507d-6f4d-4de0-a0cb-67b0420079cd` | unstarted |
| In Progress | `8db9a0a4-0706-4656-b5cd-02bb64c6ef38` | started |
| Done | `6d4f75a9-5e29-437f-8233-9de28556f622` | completed |
| Cancelled | `97fe648d-7897-40da-9819-03128e50a2a6` | cancelled |

To get all states dynamically:
```
GET https://api.plane.so/api/v1/workspaces/fincoach/projects/149b50b7-96ae-4caa-8e46-b41d0a3869d6/states/
```

---

## Known Cycles (fincoach project)

| Name | ID |
|------|----|
| Security Issues | `5e8ca191-aa7e-40b2-b1c3-b2e8bfa652f1` |
| Public Repository Pre-Flight Checklist | `f035b6e7-9252-4161-8bb7-48da21a0cc2d` |

To list cycles:
```
GET https://api.plane.so/api/v1/workspaces/fincoach/projects/149b50b7-96ae-4caa-8e46-b41d0a3869d6/cycles/
```

---

## Known Labels (fincoach project)

| Name | ID | Colour |
|------|----|--------|
| concepts | `3033a02e-9519-4e40-b5ec-c04b78ec6322` | `#9900ef` |
| admin | `75f7321a-6d43-407d-a6fb-665ec643aaca` | — |
| release-readiness | `ba64d2cc-a6be-46bf-a275-d90b92011620` | `#f97316` |

To list all labels:
```
GET https://api.plane.so/api/v1/workspaces/fincoach/projects/149b50b7-96ae-4caa-8e46-b41d0a3869d6/labels/
```

---

## Work Item Fields

Key fields for work items:

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Auto-generated |
| `name` | string | **Required** — title of the work item |
| `description_html` | string | HTML body (use `<p>text</p>`) |
| `state` | UUID | State ID (see Known States above) |
| `priority` | string | `none`, `urgent`, `high`, `medium`, `low` |
| `assignees` | UUID[] | Array of member UUIDs |
| `labels` | UUID[] | Array of label UUIDs |
| `start_date` | date | `YYYY-MM-DD` format |
| `target_date` | date | `YYYY-MM-DD` format (due date) |
| `parent` | UUID | Parent work item UUID (for sub-tasks) |
| `sequence_id` | integer | Auto-assigned display number (e.g., FIN-9) |

---

## API Operations

### List Work Items

```bash
GET /api/v1/workspaces/fincoach/projects/149b50b7-96ae-4caa-8e46-b41d0a3869d6/issues/
```

Query params:
- `per_page` — items per page (max 100, default 100)
- `cursor` — pagination cursor (`value:offset:is_prev`)
- `fields` — comma-separated field list to reduce response size
- `expand` — expand related objects (e.g., `assignees,state`)

Example:
```bash
curl -s \
  -H "X-API-Key: $PLANE_TOKEN" \
  "https://api.plane.so/api/v1/workspaces/fincoach/projects/149b50b7-96ae-4caa-8e46-b41d0a3869d6/issues/?per_page=50&expand=state"
```

---

### Get a Single Work Item

```bash
GET /api/v1/workspaces/fincoach/projects/149b50b7-96ae-4caa-8e46-b41d0a3869d6/issues/{issue_id}/
```

Example:
```bash
curl -s \
  -H "X-API-Key: $PLANE_TOKEN" \
  "https://api.plane.so/api/v1/workspaces/fincoach/projects/149b50b7-96ae-4caa-8e46-b41d0a3869d6/issues/969db991-1671-43ec-95b1-405902cce239/"
```

---

### Create a Work Item

```bash
POST /api/v1/workspaces/fincoach/projects/149b50b7-96ae-4caa-8e46-b41d0a3869d6/issues/
Content-Type: application/json
X-API-Key: $PLANE_TOKEN
```

Minimum required body:
```json
{
  "name": "Work item title"
}
```

Full example body:
```json
{
  "name": "Implement savings rate tracker",
  "description_html": "<p>Track monthly savings as a percentage of income.</p>",
  "state": "665b507d-6f4d-4de0-a0cb-67b0420079cd",
  "priority": "high",
  "assignees": ["a9d9c2be-6cc2-4a75-806a-78293f0bd7ec"],
  "labels": ["ba64d2cc-a6be-46bf-a275-d90b92011620"],
  "start_date": "2026-06-24",
  "target_date": "2026-06-30"
}
```

Shell example:
```bash
curl -s -X POST \
  -H "X-API-Key: $PLANE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "My new work item", "priority": "medium"}' \
  "https://api.plane.so/api/v1/workspaces/fincoach/projects/149b50b7-96ae-4caa-8e46-b41d0a3869d6/issues/"
```

Returns `201 Created` with the new work item object.

---

### Update a Work Item (partial PATCH)

```bash
PATCH /api/v1/workspaces/fincoach/projects/149b50b7-96ae-4caa-8e46-b41d0a3869d6/issues/{issue_id}/
Content-Type: application/json
X-API-Key: $PLANE_TOKEN
```

Only include fields you want to change:
```json
{
  "state": "8db9a0a4-0706-4656-b5cd-02bb64c6ef38",
  "priority": "urgent"
}
```

Shell example:
```bash
curl -s -X PATCH \
  -H "X-API-Key: $PLANE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"state": "8db9a0a4-0706-4656-b5cd-02bb64c6ef38"}' \
  "https://api.plane.so/api/v1/workspaces/fincoach/projects/149b50b7-96ae-4caa-8e46-b41d0a3869d6/issues/969db991-1671-43ec-95b1-405902cce239/"
```

Returns `200 OK` with the updated work item object.

---

### Delete a Work Item

```bash
DELETE /api/v1/workspaces/fincoach/projects/149b50b7-96ae-4caa-8e46-b41d0a3869d6/issues/{issue_id}/
X-API-Key: $PLANE_TOKEN
```

Shell example:
```bash
curl -s -X DELETE \
  -H "X-API-Key: $PLANE_TOKEN" \
  "https://api.plane.so/api/v1/workspaces/fincoach/projects/149b50b7-96ae-4caa-8e46-b41d0a3869d6/issues/969db991-1671-43ec-95b1-405902cce239/"
```

Returns `204 No Content` on success.

---

### Get Comments on a Work Item

Always fetch comments when reading a work item to get the full picture — comments often contain status notes, accepted-risk decisions, duplicate markers, or resolution context that is not in the description.

```bash
GET /api/v1/workspaces/fincoach/projects/149b50b7-96ae-4caa-8e46-b41d0a3869d6/issues/{issue_id}/comments/
```

Shell example:
```bash
curl -s \
  -H "X-API-Key: $PLANE_TOKEN" \
  "https://api.plane.so/api/v1/workspaces/fincoach/projects/149b50b7-96ae-4caa-8e46-b41d0a3869d6/issues/969db991-1671-43ec-95b1-405902cce239/comments/"
```

Returns a `results` array of comment objects. Each comment has:
- `id` — comment UUID
- `comment_html` — HTML-formatted comment body
- `actor_detail.display_name` — who posted it
- `created_at` — timestamp

### Add a Comment to a Work Item

```bash
POST /api/v1/workspaces/fincoach/projects/149b50b7-96ae-4caa-8e46-b41d0a3869d6/issues/{issue_id}/comments/
Content-Type: application/json
X-API-Key: $PLANE_TOKEN
```

Body:
```json
{
  "comment_html": "<p>Your comment text here.</p>"
}
```

Shell example:
```bash
curl -s -X POST \
  -H "X-API-Key: $PLANE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"comment_html": "<p>Fixed in commit abc123.</p>"}' \
  "https://api.plane.so/api/v1/workspaces/fincoach/projects/149b50b7-96ae-4caa-8e46-b41d0a3869d6/issues/{issue_id}/comments/"
```

Returns `201 Created` with the new comment object.

---

## Labels

### List Labels

```bash
GET /api/v1/workspaces/fincoach/projects/149b50b7-96ae-4caa-8e46-b41d0a3869d6/labels/
```

### Create a Label

```bash
POST /api/v1/workspaces/fincoach/projects/149b50b7-96ae-4caa-8e46-b41d0a3869d6/labels/
Content-Type: application/json
X-API-Key: $PLANE_TOKEN
```

Body:
```json
{
  "name": "my-label",
  "color": "#f97316"
}
```

Returns the new label object including `id`, `name`, `color`.

Shell example:
```bash
curl -s -X POST \
  -H "X-API-Key: $PLANE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "release-readiness", "color": "#f97316"}' \
  "https://api.plane.so/api/v1/workspaces/fincoach/projects/149b50b7-96ae-4caa-8e46-b41d0a3869d6/labels/"
```

### Apply / Remove Labels on a Work Item

Labels are set by PATCHing the work item with the full desired `labels` array (UUID list).
To **add** a label, fetch the current labels first, then PATCH with the merged list.
To **remove** a label, PATCH with the list excluding the label to remove.
To **replace** all labels, PATCH with the new list directly.

```bash
# Apply a single label (replaces any existing labels)
curl -s -X PATCH \
  -H "X-API-Key: $PLANE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"labels": ["ba64d2cc-a6be-46bf-a275-d90b92011620"]}' \
  "https://api.plane.so/api/v1/workspaces/fincoach/projects/149b50b7-96ae-4caa-8e46-b41d0a3869d6/issues/{issue_id}/"
```

### Delete a Label

```bash
DELETE /api/v1/workspaces/fincoach/projects/149b50b7-96ae-4caa-8e46-b41d0a3869d6/labels/{label_id}/
```

Returns `204 No Content` on success.

---

## Cycles

> **Important**: Cycle CRUD (create, update, delete) uses `/api/v2`. Adding/removing issues from cycles uses `/api/v1`. The v1 endpoint returns `"Project ID is required"` for cycle creation regardless of the body.

### List Cycles

```bash
GET /api/v1/workspaces/fincoach/projects/149b50b7-96ae-4caa-8e46-b41d0a3869d6/cycles/
```

Returns cycle objects with `id`, `name`, `start_date`, `end_date`, and issue counts by state group.

### Create a Cycle

```bash
POST /api/v2/workspaces/fincoach/projects/149b50b7-96ae-4caa-8e46-b41d0a3869d6/cycles/
Content-Type: application/json
X-API-Key: $PLANE_TOKEN
```

Required field: `name`. Optional: `description`, `start_date`, `end_date` (ISO `YYYY-MM-DD`).

```json
{
  "name": "Sprint 1 — Auth & Onboarding",
  "description": "First sprint covering auth and onboarding flows",
  "start_date": "2026-07-01",
  "end_date": "2026-07-14"
}
```

Shell example:
```bash
curl -s -X POST \
  -H "X-API-Key: $PLANE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "My Cycle", "start_date": "2026-07-01", "end_date": "2026-07-14"}' \
  "https://api.plane.so/api/v2/workspaces/fincoach/projects/149b50b7-96ae-4caa-8e46-b41d0a3869d6/cycles/"
```

Returns `201 Created` with `id`, `name`, `start_date`, `end_date`, `owned_by_id`, `created_at`.

### Update a Cycle

```bash
PATCH /api/v2/workspaces/fincoach/projects/149b50b7-96ae-4caa-8e46-b41d0a3869d6/cycles/{cycle_id}/
Content-Type: application/json
X-API-Key: $PLANE_TOKEN
```

Include only fields to change (`name`, `description`, `start_date`, `end_date`).

### Delete a Cycle

```bash
DELETE /api/v2/workspaces/fincoach/projects/149b50b7-96ae-4caa-8e46-b41d0a3869d6/cycles/{cycle_id}/
X-API-Key: $PLANE_TOKEN
```

Returns `204 No Content` on success.

### Add Issues to a Cycle

```bash
POST /api/v1/workspaces/fincoach/projects/149b50b7-96ae-4caa-8e46-b41d0a3869d6/cycles/{cycle_id}/cycle-issues/
Content-Type: application/json
X-API-Key: $PLANE_TOKEN
```

Body — array of issue UUIDs:
```json
{
  "issues": ["uuid1", "uuid2", "uuid3"]
}
```

Returns an array of cycle-issue mapping objects. Issues already in the cycle are silently ignored (idempotent).

Shell example:
```bash
curl -s -X POST \
  -H "X-API-Key: $PLANE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"issues": ["issue-uuid-1", "issue-uuid-2"]}' \
  "https://api.plane.so/api/v1/workspaces/fincoach/projects/149b50b7-96ae-4caa-8e46-b41d0a3869d6/cycles/5e8ca191-aa7e-40b2-b1c3-b2e8bfa652f1/cycle-issues/"
```

### List Issues in a Cycle

```bash
GET /api/v1/workspaces/fincoach/projects/149b50b7-96ae-4caa-8e46-b41d0a3869d6/cycles/{cycle_id}/cycle-issues/
```

Returns the full issue objects (not cycle-issue mappings) in the `results` array. The `id` field is the **issue UUID**, not a mapping ID.

---

## Pagination

The API returns a paginated envelope:

```json
{
  "next_cursor": "100:1:0",
  "prev_cursor": "100:0:1",
  "next_page_results": true,
  "prev_page_results": false,
  "count": 100,
  "total_results": 250,
  "results": [ ... ]
}
```

To fetch all items, loop using `next_cursor` until `next_page_results` is `false`.

---

## Error Handling

| Status | Meaning |
|--------|---------|
| 200 OK | GET/PATCH success |
| 201 Created | POST success |
| 204 No Content | DELETE success |
| 400 Bad Request | Invalid request body |
| 401 Unauthorized | Missing or invalid API key |
| 404 Not Found | Work item or resource not found |
| 429 Too Many Requests | Rate limit exceeded (60 req/min) |

On error, parse the response JSON for a descriptive message.

---

## Displaying Results

When listing or showing work items, present them as a Markdown table with these columns:

| # | ID (short) | Title | State | Priority | Due Date |
|---|-----------|-------|-------|----------|---------|

Shorten UUIDs to the first 8 characters for display (e.g., `969db991`).
Use `sequence_id` as the `#` column if available (e.g., `FIN-9`).

---

## Execution Approach

1. Always use `run_in_terminal` to execute `curl` commands.
2. Read `$PLANE_TOKEN` from the environment — it is set in `~/.bashrc`.
3. Parse JSON responses with `python3 -m json.tool` or `jq` for readability.
4. On success, confirm the operation to the user with the work item ID and title.
5. On error, show the HTTP status and error message; suggest corrective action.
6. Use `/api/v2` for cycle creation/update/delete; use `/api/v1` for everything else.

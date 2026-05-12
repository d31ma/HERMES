# API Routes Reference

## New Routes (v26.20.1)

### Snooze
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/snooze` | JWT | Snooze an email until a future time. Body: `{ emailId, until }` |
| GET | `/snooze` | JWT | List all snoozed emails |

### Send / Scheduled
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/send` | JWT | Send email. Supports `delayMs` for undo window, `sendAt` for scheduling |
| GET | `/send/scheduled` | JWT | List scheduled sends |
| DELETE | `/send/scheduled` | JWT | Cancel a scheduled send. Body: `{ id }` |
| POST | `/send/undo` | JWT | Undo a delayed send. Body: `{ undoId }` |
| POST | `/send/flush` | JWT | Process all expired outbox entries |

### Templates
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/templates` | JWT | List saved templates |
| POST | `/templates` | JWT | Save a template. Body: `{ name, subject, text, to, cc }` |
| DELETE | `/templates` | JWT | Delete a template. Body: `{ id }` |

### Signatures
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/signatures` | JWT | List signatures for user's domains |
| POST | `/signatures` | JWT | Save a signature. Body: `{ domain, name, text }` |
| DELETE | `/signatures/:id` | JWT | Delete a signature |

### Search
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/search?q=...` | JWT | Full-text search with Gmail-like query syntax |

### Threads
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/threads` | JWT | List threaded conversations for a folder |

### Tracking (Unauthenticated)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/track/open?id=...` | None | 1x1 tracking pixel. Records open event |
| GET | `/track/click?url=...&id=...` | None | Link redirect proxy. Records click, 302 to URL |

### Events (Unauthenticated — Webhook Secret)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/events/bounce` | `x-webhook-secret` header | Process bounce notification |
| POST | `/events/complaint` | `x-webhook-secret` header | Process complaint notification |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | Yes | Secret for signing/verifying JWTs |
| `INBOUND_WEBHOOK_SECRET` | Yes | HMAC secret for inbound webhook signatures |
| `EVENTS_WEBHOOK_SECRET` | Yes | Secret for bounce/complaint webhook auth |
| `TRUSTED_PROXY_SECRET` | No | If set, requires `x-trusted-proxy-secret` header on all requests |

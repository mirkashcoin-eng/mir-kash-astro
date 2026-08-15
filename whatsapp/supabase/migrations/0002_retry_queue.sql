-- Mir Kash WhatsApp — Phase 1.1: retry queue for failed sends.
--
-- webhook_events already stores every event durably (it IS the queue). What was missing
-- is a worker that re-attempts the ones whose Meta send failed (status='error'). This
-- migration just adds a bounded attempt counter so the `wa-retry` worker can retry a
-- transient failure a few times and then give up (poison-message guard) instead of
-- looping forever. Safe + additive — nothing about the existing webhook path changes.

alter table webhook_events
  add column if not exists retry_count int not null default 0;

-- The retry worker scans status='error' rows within a recent window; a partial index
-- keeps that scan cheap.
create index if not exists idx_webhook_events_retry
  on webhook_events (received_at)
  where status = 'error';

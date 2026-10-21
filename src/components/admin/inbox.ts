// The Action inbox (Do today): GET /api/admin/inbox, grouped by kind; Done posts
// {kind, ref, outcome} to the same endpoint. doneMenu/wireDone are also used by the
// person drawer's "Mark handled".
import type { InboxItem, InboxKind } from './types';
import * as data from './data';
import { outcomeLabel } from './mapping';
import { panel, term } from './charts';
import { esc } from './format';
import { mount } from './views';

// ── Today: inbox ─────────────────────────────────────────────────────────────
// Ranked by the API; each group shows its top INBOX_TOP and a "Show all N" button.
const INBOX_TOP = 10;

/** "Done" with the outcomes the API suggests for this kind of item. */
export function doneMenu(kind: string, ref: string, outcomes: string[], label = 'Done'): string {
  return '<details class="ad-done"><summary class="ad-btn ad-btn--ghost">' + esc(label) + '</summary>' +
    '<div class="ad-done__menu" role="group" aria-label="What happened?"><span class="ad-mut ad-small">What happened?</span>' +
    outcomes.map((o) => '<button type="button" class="ad-btn ad-btn--ghost ad-btn--sm" data-kind="' + esc(kind) + '" data-ref="' + esc(ref) + '" data-outcome="' + esc(o) + '">' + esc(outcomeLabel(o)) + '</button>').join('') +
    '</div></details>';
}

function inboxRow(it: InboxItem, hidden: boolean): string {
  const title = it.personId
    ? '<button type="button" class="ad-linkbtn ad-linkbtn--strong" data-person="' + esc(it.personId) + '">' + esc(it.title) + '</button>'
    : '<strong>' + esc(it.title) + '</strong>';
  const wa = it.whatsapp
    ? '<a class="ad-btn" href="' + esc(it.whatsapp) + '" target="_blank" rel="noopener">WhatsApp</a>'
    : it.kind === 'hot_lead' || it.kind === 'payment_failed' ? '<span class="ad-mut ad-small ad-irow__note">No number to contact</span>' : '';
  return '<div class="ad-irow"' + (hidden ? ' hidden data-more' : '') + ' data-item="' + esc(it.id) + '"><div class="ad-irow__main">' + title +
    '<div class="ad-mut ad-small">' + esc(it.detail) + '</div></div>' + wa + doneMenu(it.kind, it.ref, it.outcomes) +
    '<p class="ad-irow__msg ad-small" role="status"></p></div>';
}

/** Wires every outcome button under `root` to POST /api/admin/inbox. */
export function wireDone(root: HTMLElement, onDone: (btn: HTMLElement, outcome: string) => void) {
  root.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest('[data-outcome]') as HTMLButtonElement | null;
    if (!b || !root.contains(b)) return;
    const menu = b.closest('.ad-done__menu') as HTMLElement;
    const msg = (b.closest('.ad-irow')?.querySelector('[role=status]') || root.querySelector('[data-drawer-msg]')) as HTMLElement | null;
    menu.querySelectorAll('button').forEach((x) => { (x as HTMLButtonElement).disabled = true; });
    if (msg) msg.textContent = 'Saving…';
    const err = await data.markDone(b.getAttribute('data-kind') as InboxKind, b.getAttribute('data-ref')!, b.getAttribute('data-outcome')!);
    if (err) {
      menu.querySelectorAll('button').forEach((x) => { (x as HTMLButtonElement).disabled = false; });
      if (msg) { msg.textContent = err; msg.classList.add('is-bad'); }
      return;
    }
    if (msg) { msg.textContent = ''; msg.classList.remove('is-bad'); }
    onDone(b, b.getAttribute('data-outcome')!);
  });
}

export function renderInbox(el: HTMLElement, onOpenPerson: (id: string) => void, onCount: (n: number) => void) {
  return mount(el, data.getInbox(), (d) => {
    if (!d.total) return panel('Nothing needs you right now', '', '<p class="ad-note">Hot leads, failed payments, bookings to confirm and sold-out demand will show up here.</p>');
    return '<div class="ad-inbox">' + d.groups.map((g) =>
      '<section class="ad-panel ad-panel--flush" data-group="' + g.key + '"><div class="ad-panel__h"><h3 class="ad-panel__t">' + esc(g.title) + '</h3>' + term(g.title) + '<span class="ad-chip" data-gcount>' + g.items.length + '</span></div>' +
      g.items.map((it, i) => inboxRow(it, i >= INBOX_TOP)).join('') +
      (g.items.length > INBOX_TOP ? '<div class="ad-irow ad-irow--more"><button type="button" class="ad-btn ad-btn--ghost" data-showall aria-expanded="false">Show all ' + g.items.length + '</button></div>' : '') +
      '</section>').join('') + '</div>';
  }, (d) => {
    onCount(d.total);
    el.querySelectorAll('[data-person]').forEach((b) => b.addEventListener('click', () => onOpenPerson((b as HTMLElement).getAttribute('data-person')!)));
    el.querySelectorAll('[data-showall]').forEach((b) => b.addEventListener('click', () => {
      const sec = b.closest('section')!;
      sec.querySelectorAll('[data-more]').forEach((r) => { (r as HTMLElement).hidden = false; r.removeAttribute('data-more'); });
      b.closest('.ad-irow')!.remove();
    }));
    wireDone(el, (btn) => {
      const row = btn.closest('.ad-irow') as HTMLElement;
      const sec = row.closest('section') as HTMLElement;
      row.remove();
      // Pull the next hidden row up so the group still shows its top ten.
      const next = sec.querySelector('[data-more]') as HTMLElement | null;
      if (next) { next.hidden = false; next.removeAttribute('data-more'); }
      const left = sec.querySelectorAll('.ad-irow[data-item]').length;
      const chip = sec.querySelector('[data-gcount]'); if (chip) chip.textContent = String(left);
      const more = sec.querySelector('[data-showall]') as HTMLElement | null;
      if (more) { if (!sec.querySelector('[data-more]')) more.closest('.ad-irow')!.remove(); else more.textContent = 'Show all ' + left; }
      if (!left) sec.remove();
      onCount(el.querySelectorAll('.ad-irow[data-item]').length);
    });
  });
}


// A small searchable dropdown ("combobox") — the booking forms' country field,
// the same control in Try at Home and Private Viewing.
//
// Type to filter, ↑/↓ to move, Enter to choose, Esc to close. With
// `allowCustom`, text that isn't in the list is still accepted: a "Use “…”" row
// is offered, and leaving the field keeps what was typed. Without it (country),
// only a listed option can be chosen, and leaving the field puts back the last
// choice.
//
// Markup it expects (styles in src/styles/booking-wizard.css):
//   <div class="bw-combo"><input …><div class="bw-combo__list" hidden></div></div>

export interface ComboOption {
  value: string;
  label: string;
  /** Shown before the label, e.g. a flag. */
  prefix?: string;
  /** Extra text that matches a search but isn't shown, e.g. "Bombay". */
  keywords?: string;
}

export interface ComboConfig {
  input: HTMLInputElement;
  list: HTMLElement;
  options: () => ComboOption[];
  allowCustom?: boolean;
  /** How many matches to show at once. */
  max?: number;
  /** A listed option, or `null` with the typed text for a custom entry ('' when cleared). */
  onCommit: (opt: ComboOption | null, text: string) => void;
}

export interface Combo {
  /** Show this option as chosen without firing onCommit (restoring a draft, geo prefill). */
  set(opt: ComboOption | null, text?: string): void;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

let uid = 0;

export function makeCombobox(cfg: ComboConfig): Combo {
  const { input, list } = cfg;
  const max = cfg.max ?? 8;
  const id = `bw-combo-${++uid}`;
  let shown: ComboOption[] = [];
  let customText = '';
  let activeIdx = -1;
  let committed = input.value;

  list.id = `${id}-list`;
  list.setAttribute('role', 'listbox');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', list.id);
  input.setAttribute('aria-expanded', 'false');
  input.autocomplete = 'off';

  function matches(q: string): ComboOption[] {
    const all = cfg.options();
    if (!q) return all.slice(0, max);
    const starts: ComboOption[] = [];
    const contains: ComboOption[] = [];
    for (const o of all) {
      const l = fold(o.label);
      if (l.startsWith(q)) starts.push(o);
      else if (l.includes(q) || (o.keywords && fold(o.keywords).includes(q))) contains.push(o);
    }
    return [...starts, ...contains].slice(0, max);
  }

  function render() {
    // Untouched since the last choice (just focused): show the whole list, not
    // only the entries matching what's already there.
    const raw = input.value === committed ? '' : input.value.trim();
    const q = fold(raw);
    shown = matches(q);
    const exact = shown.some((o) => fold(o.label) === q);
    customText = cfg.allowCustom && raw && !exact ? raw : '';
    list.innerHTML = '';
    const rows: HTMLElement[] = [];
    shown.forEach((o, i) => {
      const row = document.createElement('div');
      row.className = 'bw-combo__opt';
      row.id = `${id}-o${i}`;
      row.setAttribute('role', 'option');
      if (o.prefix) {
        const p = document.createElement('span');
        p.className = 'bw-combo__prefix';
        p.textContent = o.prefix;
        row.appendChild(p);
      }
      row.appendChild(document.createTextNode(o.label));
      row.addEventListener('mousedown', (e) => { e.preventDefault(); choose(i); });
      rows.push(row);
    });
    if (customText) {
      const row = document.createElement('div');
      row.className = 'bw-combo__opt bw-combo__opt--custom';
      row.id = `${id}-o${shown.length}`;
      row.setAttribute('role', 'option');
      row.textContent = `Use “${customText}”`;
      row.addEventListener('mousedown', (e) => { e.preventDefault(); choose(shown.length); });
      rows.push(row);
    }
    if (!rows.length) {
      const row = document.createElement('div');
      row.className = 'bw-combo__empty';
      row.textContent = 'No match';
      rows.push(row);
    }
    rows.forEach((r) => list.appendChild(r));
    activeIdx = q && (shown.length || customText) ? 0 : -1;
    paintActive();
  }

  function paintActive() {
    list.querySelectorAll<HTMLElement>('[role="option"]').forEach((r, i) => {
      r.toggleAttribute('data-active', i === activeIdx);
      if (i === activeIdx) r.scrollIntoView({ block: 'nearest' });
    });
    if (activeIdx >= 0) input.setAttribute('aria-activedescendant', `${id}-o${activeIdx}`);
    else input.removeAttribute('aria-activedescendant');
  }

  function open() {
    render();
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }
  function close() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    activeIdx = -1;
  }

  function commit(opt: ComboOption | null, text: string) {
    input.value = opt ? opt.label : text;
    committed = input.value;
    close();
    cfg.onCommit(opt, opt ? opt.label : text);
  }

  function choose(i: number) {
    if (i < shown.length) commit(shown[i], shown[i].label);
    else if (customText) commit(null, customText);
  }

  // Leaving the field: an exact (case-insensitive) match picks that option; any
  // other text is kept as typed when custom entries are allowed, else reverted.
  function settle() {
    const raw = input.value.trim();
    if (raw === committed.trim()) { close(); return; }
    if (!raw) { commit(null, ''); return; }
    const exact = cfg.options().find((o) => fold(o.label) === fold(raw));
    if (exact) commit(exact, exact.label);
    else if (cfg.allowCustom) commit(null, raw);
    else { input.value = committed; close(); }
  }

  input.addEventListener('focus', () => { input.select(); open(); });
  input.addEventListener('input', open);
  input.addEventListener('blur', settle);
  input.addEventListener('keydown', (e) => {
    const count = shown.length + (customText ? 1 : 0);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (list.hidden) open();
      else if (count) { activeIdx = (activeIdx + 1) % count; paintActive(); }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (count) { activeIdx = (activeIdx - 1 + count) % count; paintActive(); }
    } else if (e.key === 'Enter') {
      if (list.hidden) return;
      e.preventDefault();
      if (activeIdx >= 0) choose(activeIdx); else settle();
    } else if (e.key === 'Escape') {
      if (!list.hidden) { e.preventDefault(); input.value = committed; close(); }
    }
  });

  return {
    set(opt, text = '') {
      input.value = opt ? opt.label : text;
      committed = input.value;
    },
  };
}

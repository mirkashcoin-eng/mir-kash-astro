// Shared behaviour for the site's centered dialogs (ViewingPrompt, CartExitPanel): scroll lock,
// the rest of the page made inert, focus moved in and restored, Tab kept inside, and an entrance
// driven by an `is-in` class that the component's CSS choreographs.
//
// `root` is the full-viewport wrapper (it's moved to <body> so the page behind can be made inert
// without inerting the dialog); `card` is the focusable dialog box inside it.

export interface Dialog {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
}

export function createDialog(root: HTMLElement, card: HTMLElement, exitMs: number): Dialog {
  if (root.parentElement !== document.body) document.body.appendChild(root);
  const html = document.documentElement;
  let previousFocus: Element | null = null;
  let inerted: HTMLElement[] = [];
  let isOpen = false;

  function lockPage() {
    const gap = window.innerWidth - html.clientWidth; // classic scrollbar width; 0 for overlay scrollbars
    html.style.overflow = 'hidden';
    if (gap > 0) html.style.paddingRight = `${gap}px`;
    inerted = ([...document.body.children] as HTMLElement[])
      .filter((n) => n !== root && !/^(SCRIPT|STYLE|LINK|NOSCRIPT)$/.test(n.tagName) && !n.inert);
    inerted.forEach((n) => { n.inert = true; });
  }
  function unlockPage() {
    html.style.overflow = '';
    html.style.paddingRight = '';
    inerted.forEach((n) => { n.inert = false; });
    inerted = [];
  }
  function trapTab(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const focusables = [...card.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea')]
      .filter((n) => n.offsetParent !== null && !(n as HTMLButtonElement).disabled);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === card)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  return {
    get isOpen() { return isOpen; },
    open() {
      if (isOpen) return;
      previousFocus = document.activeElement;
      root.hidden = false;
      lockPage();
      void root.offsetWidth; // commit the start state so the entrance transitions
      root.classList.add('is-in');
      card.focus({ preventScroll: true });
      document.addEventListener('keydown', trapTab);
      isOpen = true;
    },
    close() {
      if (!isOpen) return;
      isOpen = false;
      root.classList.remove('is-in');
      document.removeEventListener('keydown', trapTab);
      unlockPage();
      if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
      // Fixed length, matching the component's exit transitions. transitionend isn't used: it bubbles
      // up from whichever child finishes first and would hide the dialog mid-fade.
      setTimeout(() => { if (!isOpen) root.hidden = true; }, exitMs);
    },
  };
}

// The About sheet behind the ℹ button: credits, texture licences and the
// "something not right?" link. They are reference material, not chrome, so
// they stay out of the frame until asked for.

export function initAbout(): void {
  const btn = document.getElementById('info-btn');
  const sheet = document.getElementById('about');
  if (!btn || !sheet) return;

  const setOpen = (open: boolean): void => {
    sheet.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) (sheet.querySelector('.about-x') as HTMLElement | null)?.focus();
  };

  btn.addEventListener('click', () => setOpen(!!sheet.hidden));
  // Both the scrim and the ✕ carry data-about-close, so one listener covers them.
  sheet.querySelectorAll('[data-about-close]').forEach((el) => {
    el.addEventListener('click', () => setOpen(false));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheet.hidden) setOpen(false);
  });
}

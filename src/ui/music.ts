// Deferred background-music controller.
//
// The audio file is large, so init() is called *after* the first frame paints
// (see main.ts) — its download never competes with showing the first slide.
// A toggle button starts/stops it with a short volume fade; the choice is
// remembered, and resumed on the user's next interaction (browsers block
// autoplay-with-sound until a gesture).

const MUSIC_FILE = 'Journey_Through_the_Solar_System_2026-06-10T072340.mp3';
const STORAGE_KEY = 'gravity-music';
const TARGET_VOLUME = 0.32;

export function initMusic(): void {
  const btn = document.getElementById('music-toggle') as HTMLButtonElement | null;
  if (!btn) return;

  const audio = new Audio();
  audio.loop = true;
  audio.preload = 'auto';
  audio.volume = 0;
  audio.src = `${import.meta.env.BASE_URL}audio/${MUSIC_FILE}`;

  let on = false;
  let fadeRaf = 0;

  function fadeTo(target: number, done?: () => void): void {
    cancelAnimationFrame(fadeRaf);
    const step = (): void => {
      const d = target - audio.volume;
      if (Math.abs(d) < 0.01) { audio.volume = target; done?.(); return; }
      audio.volume = Math.max(0, Math.min(1, audio.volume + d * 0.08));
      fadeRaf = requestAnimationFrame(step);
    };
    step();
  }

  function setOn(next: boolean): void {
    on = next;
    btn!.classList.toggle('on', on);
    btn!.setAttribute('aria-pressed', String(on));
    if (on) {
      audio.play()
        .then(() => fadeTo(TARGET_VOLUME))
        .catch(() => { on = false; btn!.classList.remove('on'); btn!.setAttribute('aria-pressed', 'false'); });
    } else {
      fadeTo(0, () => audio.pause());
    }
    try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); } catch { /* private mode */ }
  }

  btn.addEventListener('click', () => setOn(!on));
  btn.hidden = false;

  // If music was on last visit, resume it on the first user gesture.
  let remembered = false;
  try { remembered = localStorage.getItem(STORAGE_KEY) === '1'; } catch { /* ignore */ }
  if (remembered) {
    const resume = (): void => { window.removeEventListener('pointerdown', resume); setOn(true); };
    window.addEventListener('pointerdown', resume, { once: true });
  }
}

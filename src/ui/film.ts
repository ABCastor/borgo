export function openFilm(opener: HTMLElement): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'film-dialog';
  dialog.setAttribute('aria-labelledby', 'film-title');
  dialog.innerHTML = `<form method="dialog"><h2 id="film-title">Borgo in 53 seconds</h2><button class="pill-btn" aria-label="Close film">Close</button></form><video controls preload="none" playsinline poster="media/borgo-film-poster.jpg"><source src="media/borgo-film.mp4" type="video/mp4"></video><p>Music: <a href="https://freemusicarchive.org/music/Ketsa/vintage-modernity/happy-soul/" target="_blank" rel="noopener">“Happy Soul” by Ketsa</a>, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>.</p>`;
  dialog.addEventListener('close', () => {
    dialog.querySelector('video')?.pause();
    dialog.remove();
    opener.focus();
  }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
}

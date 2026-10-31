const DURACAO_VISIVEL_MS = 500;

export function estaEmAppInstalado(): boolean {
  const navegador = navigator as Navigator & { standalone?: boolean };
  return (
    navegador.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches
  );
}

/* Força o iOS a recompor a janela uma vez no carregamento, imitando a animação de uma gaveta fixa.
   Sem isso o iOS 27 mantém a camada de transparência sobre os primeiros ~85pt do app instalado, que
   escurece e borra o header. A capa e o painel são branco a 1% com pointer-events: none. O painel
   precisa ficar montado para fora da tela, nunca removido do DOM — removê-lo traz a camada de volta. */
export function nudgeIosTopBlur(): void {
  if (!/iPhone|iPad|iPod/.test(navigator.userAgent)) return;
  if (!estaEmAppInstalado()) return;
  if (document.getElementById('ios-blur-panel')) return;

  const cover = document.createElement('div');
  cover.id = 'ios-blur-cover';
  cover.setAttribute('aria-hidden', 'true');

  const panel = document.createElement('div');
  panel.id = 'ios-blur-panel';
  panel.setAttribute('aria-hidden', 'true');

  document.body.append(cover, panel);
  void panel.offsetWidth;

  requestAnimationFrame(() => {
    cover.style.display = 'block';
    cover.style.animation = 'ios-blur-fade 0.3s ease-out';
    panel.style.transform = 'translateX(0%)';
    setTimeout(() => {
      cover.style.display = 'none';
      cover.style.animation = '';
      panel.style.transform = 'translateX(110%)';
    }, DURACAO_VISIVEL_MS);
  });
}

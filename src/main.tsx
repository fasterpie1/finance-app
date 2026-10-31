import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/ios-top-blur.css'
import App from './App.tsx'

// O iOS pinta a camada de transparência sobre a borda superior só no app instalado, e "instalado"
// já foi reportado de três formas diferentes conforme a versão: navigator.standalone,
// display-mode: standalone e display-mode: fullscreen. Um @media sozinho não pega todas. Antes do
// createRoot para a primeira pintura já nascer com a classe.
const navegador = navigator as Navigator & { standalone?: boolean };
if (
  navegador.standalone === true ||
  window.matchMedia('(display-mode: standalone)').matches ||
  window.matchMedia('(display-mode: fullscreen)').matches
) {
  document.documentElement.classList.add('ios-standalone');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/ios-top-blur.css'
import App from './App.tsx'
import { nudgeIosTopBlur } from './services/iosTopBlur'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// A recomposição que derruba a camada de transparência do iOS 27 precisa rodar depois que a janela
// já tem tamanho e a primeira pintura aconteceu, por isso o load em vez de logo acima.
if (document.readyState === 'complete') nudgeIosTopBlur();
else window.addEventListener('load', nudgeIosTopBlur, { once: true });

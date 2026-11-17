import { useEffect, useRef, useState } from 'react';
import './AppOpeningAnimation.css';

export function AppOpeningAnimation() {
  const [visible, setVisible] = useState(true);
  const [cycle, setCycle] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  const lastShownAt = useRef(0);

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    lastShownAt.current = Date.now();
    const show = () => {
      const now = Date.now();
      if (now - lastShownAt.current < 300) return;
      lastShownAt.current = now;
      window.clearTimeout(timer.current);
      setCycle((current) => current + 1);
      setVisible(true);
      timer.current = window.setTimeout(() => setVisible(false), reducedMotion ? 800 : 2520);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') show();
      else {
        window.clearTimeout(timer.current);
        setVisible(false);
      }
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted && document.visibilityState === 'visible') show();
    };

    timer.current = window.setTimeout(() => setVisible(false), reducedMotion ? 800 : 2520);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  if (!visible) return null;

  return (
    <div key={cycle} className="app-opening-animation" role="img" aria-label="Finança Pessoal">
      <svg className="app-opening-logo" viewBox="0 0 768 768" aria-hidden="true">
        <defs>
          <linearGradient id="opening-gold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff2a8" />
            <stop offset="0.42" stopColor="#f8c95c" />
            <stop offset="1" stopColor="#a96b12" />
          </linearGradient>
          <linearGradient id="opening-gold-text" x1="0" y1="0" x2="0.9" y2="1">
            <stop stopColor="#fff0a0" />
            <stop offset="0.5" stopColor="#f5c34d" />
            <stop offset="1" stopColor="#bd791b" />
          </linearGradient>
        </defs>
        <rect width="768" height="768" fill="#000" />
        <g className="opening-coin">
          <circle cx="448" cy="230" r="121" fill="url(#opening-gold)" />
          <path d="M447 142v35c-34 0-58 19-58 47 0 27 20 40 57 51 27 8 37 14 37 27 0 14-14 23-37 23-22 0-41-8-57-23l-17 31c16 17 42 27 72 29v35h20v-36c38-4 61-25 61-56 0-31-21-45-61-57-25-8-34-14-34-25 0-11 10-19 28-19 19 0 34 6 49 18l18-30c-16-13-37-21-61-24v-36z" fill="#000" />
        </g>
        <g className="opening-hand">
          <rect x="148" y="340" width="74" height="160" rx="13" fill="url(#opening-gold)" />
          <path d="M240 373c48-25 80-34 119-34 36 0 73 13 112 29 25 10 54 19 83 22 30 3 40 21 28 38-10 15-32 21-60 17l-71-10c-14-2-22 7-10 14l54 22c30 12 55 7 75-11l74-77c16-17 34-20 45-9 11 12 6 30-8 47l-82 96c-29 34-66 51-109 50-53-1-103-20-146-40l-104-49z" fill="url(#opening-gold)" />
        </g>
        <text className="opening-wordmark" x="384" y="634" textAnchor="middle" fill="url(#opening-gold-text)" fontFamily="Arial, Helvetica, sans-serif" fontSize="64" fontWeight="700" letterSpacing="1">Finança Pessoal</text>
      </svg>
    </div>
  );
}

'use client';

import dynamic from 'next/dynamic';

// Three.js (and later Privy and SmoothSend) touch `window`, so the game is
// never rendered on the server.
const Game = dynamic(() => import('@/game/Game'), {
  ssr: false,
  loading: () => <div style={{ padding: 16, color: 'var(--dim)' }}>Loading…</div>,
});

export default function PlayClient() {
  return <Game />;
}

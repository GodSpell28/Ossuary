'use client';

import dynamic from 'next/dynamic';

// Three.js, Privy and SmoothSend all touch `window`, so the game and its
// providers are never rendered on the server.
const Play = dynamic(() => import('@/game/Play'), {
  ssr: false,
  loading: () => <div style={{ padding: 16, color: 'var(--dim)' }}>Loading…</div>,
});

export default function PlayClient() {
  return <Play />;
}

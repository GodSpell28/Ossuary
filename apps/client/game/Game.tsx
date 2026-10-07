'use client';

import { dayNumber } from '@ossuary/sim';
import { useEffect, useRef, useState } from 'react';
import { Engine, type EngineStats } from './engine';

export default function Game() {
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [stats, setStats] = useState<EngineStats | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const engine = new Engine(mount, setStats, dayNumber(Date.now()));
    engineRef.current = engine;
    engine.start();
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      {stats && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            fontSize: 11,
            lineHeight: 1.5,
            color: '#8a7f70',
            pointerEvents: 'none',
            textShadow: '0 1px 0 #000',
          }}
        >
          {stats.fps} fps ({stats.simMs.toFixed(1)}+{stats.renderMs.toFixed(1)} ms) · tick {stats.tick} · tile {stats.tile[0]},{stats.tile[1]} · state {stats.hash}
        </div>
      )}
      {stats && !stats.locked && (
        <button
          onClick={() => engineRef.current?.requestLock()}
          style={{
            position: 'absolute',
            inset: 0,
            margin: 'auto',
            width: 'min(420px, calc(100% - 32px))',
            height: 'fit-content',
            padding: '20px 16px',
            background: 'rgba(7,6,10,0.85)',
            border: '2px solid #b8321e',
            color: '#e8dcc8',
            font: 'inherit',
            cursor: 'pointer',
            letterSpacing: '0.12em',
            lineHeight: 1.8,
          }}
        >
          CLICK TO DESCEND
          <br />
          <span style={{ fontSize: 12, color: '#8a7f70', letterSpacing: 0 }}>
            WASD move · mouse look · click fire · E use · Esc release
          </span>
        </button>
      )}
    </div>
  );
}

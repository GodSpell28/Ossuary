'use client';

import { KEY_BITS, RELICS, dayNumber, type SimEvent } from '@ossuary/sim';
import { useEffect, useRef, useState } from 'react';
import type { ChainLayer } from '@/chain/ChainLayer';
import { RunController } from '@/chain/RunController';
import { addressUrl } from '@/chain/config';
import { Sfx } from './audio';
import { Engine, type EngineStats, type HudState } from './engine';
import TxToasts from './TxToasts';

const PICKUP_TEXT: Record<string, string> = {
  health: 'Bone salve. +25 health',
  armor: 'Plated vest',
  ammo: 'Box of rounds',
  shells: 'Handful of shells',
  cells: 'Ember cells',
  shotgun: 'The shotgun. Press 2',
  lance: 'The Ember Lance. Press 3',
  key_red: 'Red keycard',
  key_blue: 'Blue keycard',
};

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${String(Math.floor((ms % 1000) / 100))}`;
}

export default function Game({ layer, account }: { layer: ChainLayer | null; account?: React.ReactNode }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const controllerRef = useRef<RunController | null>(null);
  const sfxRef = useRef<Sfx | null>(null);
  const sayRef = useRef<(text: string) => void>(() => {});
  const [engineReady, setEngineReady] = useState(false);
  const [graveCount, setGraveCount] = useState<number | null>(null);
  const [stats, setStats] = useState<EngineStats | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [message, setMessage] = useState<{ text: string; id: number } | null>(null);
  const [flash, setFlash] = useState<{ color: string; id: number } | null>(null);
  const [epitaph, setEpitaph] = useState<string | null>(null);
  const [held, setHeld] = useState<number[]>([]);
  const [relic, setRelic] = useState(0);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let msgId = 0;
    const say = (text: string) => setMessage({ text, id: ++msgId });
    sayRef.current = say;
    const blink = (color: string) => setFlash({ color, id: ++msgId });
    const sfx = new Sfx();
    sfxRef.current = sfx;
    const onEvent = (e: SimEvent, s: Engine['state']) => {
      controllerRef.current?.onEvent(e);
      sfx.onEvent(e, s);
      switch (e.type) {
        case 'pickup':
          say(PICKUP_TEXT[e.kind] ?? e.kind);
          blink('rgba(224,192,96,0.25)');
          break;
        case 'locked': {
          const key = engineRef.current?.levelData.doors[e.door]?.key ?? 'red';
          say(`Sealed. It needs the ${key} keycard.`);
          break;
        }
        case 'hurt':
          blink(`rgba(184,50,30,${Math.min(0.6, 0.15 + e.amount / 40)})`);
          break;
        case 'dryFire':
          say('Out of ammo. Switch weapons with 1, 2, 3 or the wheel');
          break;
        case 'death':
        case 'exit':
          // Free the mouse so the player can type an epitaph or click links.
          if (document.pointerLockElement) document.exitPointerLock();
          break;
      }
    };
    const engine = new Engine(
      mount,
      { onStats: setStats, onHud: setHud, onEvent, onRunStart: () => controllerRef.current?.onRunStart() },
      dayNumber(Date.now()),
    );
    engineRef.current = engine;
    engine.start();
    setEngineReady(true);
    if (process.env.NODE_ENV !== 'production') (window as unknown as { __ossuary?: Engine }).__ossuary = engine;

    // Browsers only start audio after a gesture.
    const unlock = () => sfx.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyR' || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      const s = engine.state;
      if (s.player.diedAt >= 0 || s.finishedAt >= 0) {
        controllerRef.current?.carve('');
        engine.restart();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('keydown', onKey);
      sfx.dispose();
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // Connect the engine to the chain once the player's smart account is ready.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !layer) return;
    const c = new RunController(engine, layer, {
      message: (t) => sayRef.current(t),
      graves: setGraveCount,
      epitaph: setEpitaph,
    });
    controllerRef.current = c;
    c.start().catch((e) => sayRef.current(`Chain: ${e instanceof Error ? e.message : e}`));
    return () => {
      c.dispose();
      controllerRef.current = null;
    };
  }, [layer, engineReady]);

  // Relics the player holds, refreshed whenever a run ends.
  const phase = hud?.phase;
  useEffect(() => {
    if (!layer || phase === 'playing') return;
    layer.relics().then(setHeld).catch(() => {});
  }, [layer, phase]);
  useEffect(() => {
    if (!layer) return;
    layer.relics().then(setHeld).catch(() => {});
  }, [layer]);

  // Messages fade after a few seconds.
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage((m) => (m?.id === message.id ? null : m)), 3500);
    return () => clearTimeout(t);
  }, [message]);

  const chooseRelic = (id: number) => {
    const engine = engineRef.current;
    if (!engine || engine.state.tick !== 0) return;
    setRelic(id);
    engine.restart(engine.seedValue, id);
  };

  const restart = () => {
    controllerRef.current?.carve('');
    const engine = engineRef.current;
    if (!engine) return;
    // A relic carried into a death is buried with you.
    const keep = relic && held[relic - 1] > (hud?.phase === 'dead' ? 1 : 0) ? relic : 0;
    setRelic(keep);
    engine.restart(engine.seedValue, keep);
    engine.requestLock();
  };

  const notStarted = !!stats && stats.tick === 0;
  const heldIds = held.map((n, i) => (n > 0 ? i + 1 : 0)).filter(Boolean);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', userSelect: 'none' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />

      {flash && (
        <div
          key={flash.id}
          style={{
            position: 'absolute',
            inset: 0,
            background: flash.color,
            pointerEvents: 'none',
            animation: 'ossuary-fade 400ms ease-out forwards',
          }}
        />
      )}

      {stats && (
        <div style={{ ...overlayText, top: 8, left: 8, fontSize: 11, color: '#6f665b' }}>
          {stats.fps} fps · tile {stats.tile[0]},{stats.tile[1]} · state {stats.hash}
        </div>
      )}

      {hud && (
        <>
          <div style={{ ...overlayText, top: 8, right: 12, textAlign: 'right', fontSize: 14 }}>
            <div>{formatTime(hud.timeMs)}</div>
            <div style={{ color: '#8a7f70' }}>
              kills {hud.kills}/{hud.totalMobs}
            </div>
            {hud.relic > 0 && <div style={{ color: '#e0c060', fontSize: 11 }}>{RELICS[hud.relic]!.name}</div>}
          </div>

          {message && (
            <div
              key={message.id}
              style={{ ...overlayText, top: '18%', left: 16, right: 16, textAlign: 'center', fontSize: 16 }}
            >
              {message.text}
            </div>
          )}

          <div style={hudBar}>
            <Stat label="HEALTH" value={hud.hp} warn={hud.hp <= 25} />
            <Stat label="ARMOR" value={hud.armor} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <Key on={!!(hud.keys & KEY_BITS.red)} color="#b8321e" />
                <Key on={!!(hud.keys & KEY_BITS.blue)} color="#52657e" />
              </div>
              <div style={{ display: 'flex', gap: 4, fontSize: 11 }}>
                {[1, 2, 3].map((n) => (
                  <span
                    key={n}
                    style={{
                      color: hud.weaponIndex === n - 1 ? '#e0c060' : hud.owned & (1 << (n - 1)) ? '#aa9e8c' : '#3d3833',
                    }}
                  >
                    {n}
                  </span>
                ))}
              </div>
            </div>
            <Stat label={hud.weapon.toUpperCase()} value={hud.ammo} warn={hud.ammo === 0} />
          </div>

          {hud.phase === 'playing' && hud.locked && <div style={crosshair} />}

          {layer && <TxToasts layer={layer} />}
          {layer && (!hud.locked || hud.phase !== 'playing') && (
            <div style={{ position: 'absolute', top: 26, left: 8, fontSize: 11, color: '#8a7f70' }}>
              smart account{' '}
              <a href={addressUrl(layer.smartAccount)} target="_blank" rel="noreferrer" style={{ color: '#aa9e8c' }}>
                {layer.smartAccount.slice(0, 8)}…{layer.smartAccount.slice(-4)}
              </a>
              {graveCount !== null && ` · ${graveCount} grave${graveCount === 1 ? '' : 's'} today`}
              {' · '}
              <a href="/leaderboard" target="_blank" style={{ color: '#aa9e8c' }}>
                leaderboard
              </a>
            </div>
          )}

          {hud.phase !== 'playing' && (
            <div style={endScreen}>
              <div
                style={{
                  fontSize: 'clamp(28px, 6vw, 56px)',
                  letterSpacing: '0.2em',
                  color: hud.phase === 'dead' ? '#b8321e' : '#e0c060',
                }}
              >
                {hud.phase === 'dead' ? 'YOU FELL' : 'ESCAPED'}
              </div>
              <div style={{ color: '#aa9e8c', marginTop: 8 }}>
                {formatTime(hud.timeMs)} · {hud.kills}/{hud.totalMobs} kills
              </div>
              {hud.phase === 'dead' && epitaph !== null && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const v = (new FormData(e.currentTarget).get('epitaph') as string) ?? '';
                    controllerRef.current?.carve(v);
                  }}
                  style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}
                >
                  <input
                    name="epitaph"
                    defaultValue={epitaph}
                    maxLength={32}
                    autoFocus
                    aria-label="Epitaph"
                    style={{
                      background: '#0a0908',
                      color: '#e8dcc8',
                      border: '1px solid #554e46',
                      padding: '8px 10px',
                      font: 'inherit',
                      width: 'min(280px, 70vw)',
                    }}
                  />
                  <button type="submit" style={{ ...button, padding: '8px 14px' }}>
                    CARVE
                  </button>
                </form>
              )}
              {hud.phase === 'dead' && (
                <div style={{ color: '#6f665b', marginTop: 8, fontSize: 13 }}>
                  {epitaph !== null ? 'Write the words on your grave.' : 'Your bones stay here for the next one.'}
                </div>
              )}
              <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
                <button onClick={restart} style={button}>
                  DESCEND AGAIN (R)
                </button>
                <a href="/leaderboard" target="_blank" style={{ ...button, textDecoration: 'none' }}>
                  LEADERBOARD
                </a>
              </div>
            </div>
          )}

          {hud.phase === 'playing' && !hud.locked && (
            <div style={{ ...centered, textAlign: 'center' }}>
              <button
                onClick={() => {
                  sfxRef.current?.unlock();
                  engineRef.current?.requestLock();
                }}
                style={{ ...button, width: '100%' }}
              >
                {notStarted ? 'CLICK TO DESCEND' : 'CLICK TO RESUME'}
                <br />
                <span style={{ fontSize: 12, color: '#8a7f70', letterSpacing: 0 }}>
                  WASD move · mouse look · click fire · E open · 1 2 3 weapons · Esc release
                </span>
              </button>
              {notStarted && heldIds.length > 0 && (
                <div style={{ ...panel, marginTop: 12 }}>
                  <div style={{ marginBottom: 6 }}>Carry a relic into the descent. Die with it and it stays in your grave.</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                    <RelicButton active={relic === 0} onClick={() => chooseRelic(0)} title="None" />
                    {heldIds.map((id) => (
                      <RelicButton
                        key={id}
                        active={relic === id}
                        onClick={() => chooseRelic(id)}
                        title={`${RELICS[id]!.name}${held[id - 1] > 1 ? ` ×${held[id - 1]}` : ''}`}
                        hint={RELICS[id]!.effect}
                      />
                    ))}
                  </div>
                </div>
              )}
              {account && <div style={{ ...panel, marginTop: 12 }}>{account}</div>}
            </div>
          )}
        </>
      )}

      <style>{`@keyframes ossuary-fade { from { opacity: 1 } to { opacity: 0 } }`}</style>
    </div>
  );
}

function RelicButton({ active, onClick, title, hint }: { active: boolean; onClick(): void; title: string; hint?: string }) {
  return (
    <button
      onClick={onClick}
      title={hint}
      style={{
        background: active ? '#3a0c0a' : 'transparent',
        color: active ? '#e0c060' : '#aa9e8c',
        border: `1px solid ${active ? '#e0c060' : '#3d3833'}`,
        padding: '4px 8px',
        font: 'inherit',
        fontSize: 12,
        cursor: 'pointer',
      }}
    >
      {title}
      {hint && <div style={{ fontSize: 10, color: '#8a7f70' }}>{hint}</div>}
    </button>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 64 }}>
      <div style={{ fontSize: 'clamp(20px, 4vw, 30px)', color: warn ? '#b8321e' : '#e8dcc8', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, color: '#8a7f70', letterSpacing: '0.2em', marginTop: 4 }}>{label}</div>
    </div>
  );
}

function Key({ on, color }: { on: boolean; color: string }) {
  return (
    <div
      style={{
        width: 14,
        height: 18,
        border: `2px solid ${on ? color : '#2a2622'}`,
        background: on ? color : 'transparent',
      }}
    />
  );
}

const overlayText: React.CSSProperties = {
  position: 'absolute',
  pointerEvents: 'none',
  color: '#e8dcc8',
  textShadow: '0 2px 0 #000',
};

const hudBar: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  display: 'flex',
  justifyContent: 'space-around',
  alignItems: 'center',
  padding: '10px 16px 14px',
  background: 'linear-gradient(transparent, rgba(0,0,0,0.75))',
  pointerEvents: 'none',
  textShadow: '0 2px 0 #000',
};

const crosshair: React.CSSProperties = {
  position: 'absolute',
  left: '50%',
  top: '50%',
  width: 4,
  height: 4,
  marginLeft: -2,
  marginTop: -2,
  background: 'rgba(232,220,200,0.7)',
  pointerEvents: 'none',
};

const centered: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  margin: 'auto',
  width: 'min(480px, calc(100% - 32px))',
  height: 'fit-content',
};

const panel: React.CSSProperties = {
  fontSize: 13,
  color: '#aa9e8c',
  background: 'rgba(7,6,10,0.85)',
  padding: 10,
};

const button: React.CSSProperties = {
  padding: '16px 20px',
  background: 'rgba(7,6,10,0.85)',
  border: '2px solid #b8321e',
  color: '#e8dcc8',
  font: 'inherit',
  cursor: 'pointer',
  letterSpacing: '0.12em',
  lineHeight: 1.8,
};

const endScreen: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(7,6,10,0.6)',
  textAlign: 'center',
  padding: 16,
};

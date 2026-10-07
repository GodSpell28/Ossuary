'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { addressUrl, txUrl } from '@/chain/config';
import { fetchLeaderboard, fetchToday, type LeaderboardRow } from '@/chain/reads';

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}

function dateOf(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

export default function Leaderboard() {
  const [day, setDay] = useState<number | null>(null);
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchToday()
      .then(setDay)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (day === null) return;
    setRows(null);
    fetchLeaderboard(day)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [day]);

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 16, lineHeight: 1.6 }}>
      <h1 style={{ letterSpacing: '0.2em', color: 'var(--bone)', marginBottom: 4 }}>LEADERBOARD</h1>
      <p style={{ color: 'var(--dim)', marginTop: 0 }}>
        Fastest verified escapes from The Charnel Descent. Every time here was replayed by the verifier and recorded
        on Avalanche Fuji.
      </p>
      {day !== null && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '12px 0' }}>
          <button style={navBtn} onClick={() => setDay(day - 1)}>
            ← previous day
          </button>
          <strong>{dateOf(day)}</strong>
          <button style={navBtn} onClick={() => setDay(day + 1)}>
            next day →
          </button>
        </div>
      )}
      {error && <p style={{ color: '#e06040' }}>{error}</p>}
      {!error && rows === null && <p style={{ color: 'var(--dim)' }}>Reading RunFinished events from Fuji…</p>}
      {rows && rows.length === 0 && <p style={{ color: 'var(--dim)' }}>Nobody has escaped yet on this day.</p>}
      {rows && rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ color: 'var(--dim)', textAlign: 'left' }}>
                <th style={cell}>#</th>
                <th style={cell}>player</th>
                <th style={cell}>time</th>
                <th style={cell}>kills</th>
                <th style={cell}>proof</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.player} style={{ borderTop: '1px solid #2a2622', color: i === 0 ? '#e0c060' : undefined }}>
                  <td style={cell}>{i + 1}</td>
                  <td style={cell}>
                    <a href={addressUrl(r.player)} target="_blank" rel="noreferrer">
                      {r.player.slice(0, 6)}…{r.player.slice(-4)}
                    </a>
                  </td>
                  <td style={cell}>{formatTime(r.timeMs)}</td>
                  <td style={cell}>{r.kills}</td>
                  <td style={cell}>
                    <a href={txUrl(r.txHash)} target="_blank" rel="noreferrer">
                      run {r.runId.toString()}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ marginTop: 24 }}>
        <Link href="/play">Descend →</Link>
      </p>
    </main>
  );
}

const cell: React.CSSProperties = { padding: '6px 8px', whiteSpace: 'nowrap' };
const navBtn: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--fg)',
  border: '1px solid #3d3833',
  padding: '4px 10px',
  font: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
};

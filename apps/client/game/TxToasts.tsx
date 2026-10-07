'use client';

import { useEffect, useState } from 'react';
import type { ChainLayer, TxStatus } from '@/chain/ChainLayer';
import { txUrl } from '@/chain/config';

const STATE_TEXT: Record<TxStatus['state'], string> = {
  queued: 'queued',
  signing: 'signing UserOp',
  submitted: 'bundler has it',
  confirmed: 'on Fuji',
  failed: 'failed',
};

/** Every sponsored write, as it moves from signing to mined, with a Snowtrace link. */
export default function TxToasts({ layer }: { layer: ChainLayer }) {
  const [txs, setTxs] = useState<TxStatus[]>([]);
  useEffect(
    () =>
      layer.onStatus((s) =>
        setTxs((prev) => [s, ...prev.filter((p) => p.id !== s.id)].slice(0, 4)),
      ),
    [layer],
  );
  // Drop finished entries after a while.
  useEffect(() => {
    const t = setInterval(
      () => setTxs((prev) => prev.filter((p) => p.state !== 'confirmed' || Date.now() - p.startedAt < 20_000)),
      2000,
    );
    return () => clearInterval(t);
  }, []);

  if (!txs.length) return null;
  return (
    <div style={{ position: 'absolute', left: 8, bottom: 76, display: 'grid', gap: 4, fontSize: 11, maxWidth: 'calc(100% - 16px)' }}>
      {txs.map((t) => (
        <div
          key={t.id}
          style={{
            background: 'rgba(7,6,10,0.8)',
            borderLeft: `3px solid ${t.state === 'failed' ? '#b8321e' : t.state === 'confirmed' ? '#5f9a38' : '#e0c060'}`,
            padding: '4px 8px',
            color: '#cbbfa8',
          }}
        >
          <strong>{t.label}</strong> · {STATE_TEXT[t.state]}
          {t.ms !== undefined && ` · ${(t.ms / 1000).toFixed(1)} s · 0 AVAX to you`}
          {t.txHash && (
            <>
              {' · '}
              <a href={txUrl(t.txHash)} target="_blank" rel="noreferrer" style={{ color: '#e0c060' }}>
                {t.txHash.slice(0, 10)}…
              </a>
            </>
          )}
          {t.error && <div style={{ color: '#e06040' }}>{t.error.slice(0, 120)}</div>}
        </div>
      ))}
    </div>
  );
}

'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useEffect, useState } from 'react';
import type { TxStatus } from '@/chain/ChainLayer';
import { GAME_ADDRESS, addressUrl, publicClient, txUrl } from '@/chain/config';
import Providers from '@/chain/Providers';
import { useChainLayer } from '@/chain/useChainLayer';

// Day-one proof: log in with email, then send a sponsored startRun to Fuji
// with zero AVAX and zero signing prompts.

export default function ChainTest() {
  return (
    <Providers>
      <Inner />
    </Providers>
  );
}

const box: React.CSSProperties = { border: '1px solid #3d3833', padding: 12, marginTop: 12, wordBreak: 'break-all' };
const btn: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--fg)',
  border: '2px solid var(--blood)',
  padding: '8px 16px',
  font: 'inherit',
  cursor: 'pointer',
  marginRight: 8,
  marginTop: 8,
};

function Inner() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { layer, error, loading } = useChainLayer();
  const [txs, setTxs] = useState<TxStatus[]>([]);
  const [info, setInfo] = useState<string>('');
  const [avax, setAvax] = useState<string>('');

  useEffect(() => {
    if (!layer) return;
    publicClient.getBalance({ address: layer.smartAccount }).then((b) => setAvax((Number(b) / 1e18).toString()));
    return layer.onStatus((s) => setTxs((prev) => [s, ...prev.filter((p) => p.id !== s.id)]));
  }, [layer]);

  const startRun = async () => {
    if (!layer) return;
    setInfo('');
    try {
      const day = await layer.today();
      const { runId } = await layer.startRun(day);
      setInfo(`Run ${runId} opened for day ${day}. Open run now: ${await layer.openRun()}`);
    } catch (e) {
      setInfo(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 16, fontSize: 14, lineHeight: 1.6 }}>
      <h1 style={{ letterSpacing: '0.15em', color: 'var(--bone)' }}>CHAIN TEST</h1>
      <p style={{ color: 'var(--dim)' }}>
        Logs in with Privy and sends a gasless <code>startRun</code> through SmoothSend on Fuji.
      </p>

      {!ready ? (
        <p>Loading Privy…</p>
      ) : !authenticated ? (
        <button style={btn} onClick={login}>
          Log in with email
        </button>
      ) : (
        <>
          <div style={box}>
            <div>User: {user?.email?.address ?? user?.google?.email ?? user?.id}</div>
            {loading && <div>Setting up smart account…</div>}
            {error && <div style={{ color: '#e06040' }}>Error: {error}</div>}
            {layer && (
              <>
                <div>
                  Owner (embedded wallet): <a href={addressUrl(layer.owner)}>{layer.owner}</a>
                </div>
                <div>
                  Smart account (msg.sender): <a href={addressUrl(layer.smartAccount)}>{layer.smartAccount}</a>
                </div>
                <div>Smart account AVAX balance: {avax || '…'} (should stay 0)</div>
              </>
            )}
          </div>
          <div>
            <button style={btn} disabled={!layer || !GAME_ADDRESS} onClick={startRun}>
              startRun(today)
            </button>
            <button style={btn} onClick={logout}>
              Log out
            </button>
          </div>
          {!GAME_ADDRESS && (
            <p style={{ color: '#e06040' }}>Contracts are not deployed yet (NEXT_PUBLIC_GAME_ADDRESS is empty).</p>
          )}
          {info && <div style={box}>{info}</div>}
          {txs.map((t) => (
            <div key={t.id} style={box}>
              <strong>{t.label}</strong> · {t.state}
              {t.ms !== undefined && ` · ${(t.ms / 1000).toFixed(1)} s`}
              {t.txHash && (
                <div>
                  tx: <a href={txUrl(t.txHash)}>{t.txHash}</a>
                </div>
              )}
              {t.userOpHash && <div style={{ color: 'var(--dim)' }}>userOp: {t.userOpHash}</div>}
              {t.error && <div style={{ color: '#e06040' }}>{t.error}</div>}
            </div>
          ))}
        </>
      )}
    </main>
  );
}

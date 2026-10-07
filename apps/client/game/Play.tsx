'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useState } from 'react';
import Providers from '@/chain/Providers';
import { useChainLayer } from '@/chain/useChainLayer';
import Game from './Game';

export default function Play() {
  return (
    <Providers>
      <WithChain />
    </Providers>
  );
}

function WithChain() {
  const { ready, authenticated, login } = usePrivy();
  const { layer, error, loading } = useChainLayer();
  const [offline, setOffline] = useState(false);

  let account: React.ReactNode = null;
  if (!ready) account = <span>Connecting…</span>;
  else if (!authenticated && !offline)
    account = (
      <>
        <div>Log in so your death leaves a grave on Avalanche.</div>
        <div style={{ marginTop: 8, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button style={smallBtn} onClick={login}>
            Log in with email
          </button>
          <button style={{ ...smallBtn, borderColor: '#3d3833' }} onClick={() => setOffline(true)}>
            Play offline
          </button>
        </div>
      </>
    );
  else if (authenticated && loading) account = <span>Preparing your smart account…</span>;
  else if (error) account = <span style={{ color: '#e06040' }}>Chain unavailable: {error}</span>;

  return <Game layer={layer} account={account} />;
}

const smallBtn: React.CSSProperties = {
  background: 'transparent',
  color: '#e8dcc8',
  border: '1px solid #b8321e',
  padding: '6px 12px',
  font: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
};

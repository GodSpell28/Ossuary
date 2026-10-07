'use client';

import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useEffect, useState } from 'react';
import { createWalletClient, custom, type Address } from 'viem';
import { ChainLayer } from './ChainLayer';
import { CHAIN } from './config';

/** Builds a ChainLayer once the player is logged in and their embedded wallet exists. */
export function useChainLayer(): { layer: ChainLayer | null; error: string | null; loading: boolean } {
  const { ready, authenticated } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const [layer, setLayer] = useState<ChainLayer | null>(null);
  const [error, setError] = useState<string | null>(null);

  const embedded = wallets.find((w) => w.walletClientType === 'privy');
  const address = embedded?.address;

  useEffect(() => {
    if (!authenticated || !embedded) {
      setLayer(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await embedded.switchChain(CHAIN.id);
        const provider = await embedded.getEthereumProvider();
        const walletClient = createWalletClient({
          account: embedded.address as Address,
          chain: CHAIN,
          transport: custom(provider),
        });
        const l = await ChainLayer.create(walletClient, embedded.address as Address);
        if (!cancelled) {
          setLayer(l);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // The wallet object identity changes on every render; key on its address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, address]);

  const loading = !ready || (authenticated && (!walletsReady || (!layer && !error)));
  return { layer, error, loading };
}

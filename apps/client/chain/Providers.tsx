'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { CHAIN, PRIVY_APP_ID } from './config';

// Email or Google login. Every user gets an embedded wallet silently, and
// showWalletUIs: false means signing a UserOp never pops a confirmation modal.
export default function Providers({ children }: { children: React.ReactNode }) {
  if (!PRIVY_APP_ID) {
    return <div style={{ padding: 16 }}>NEXT_PUBLIC_PRIVY_APP_ID is not set in apps/client/.env.local</div>;
  }
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ['email', 'google'],
        appearance: { theme: 'dark', accentColor: '#b8321e' },
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' }, showWalletUIs: false },
        defaultChain: CHAIN,
        supportedChains: [CHAIN],
      }}
    >
      {children}
    </PrivyProvider>
  );
}

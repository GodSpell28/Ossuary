import { createPublicClient, http, type Address } from 'viem';
import { avalancheFuji } from 'viem/chains';

export const CHAIN = avalancheFuji;
export const EXPLORER = 'https://testnet.snowtrace.io';

export const SMOOTHSEND_KEY = process.env.NEXT_PUBLIC_SMOOTHSEND_KEY ?? '';
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '';
export const GAME_ADDRESS = (process.env.NEXT_PUBLIC_GAME_ADDRESS || undefined) as Address | undefined;
export const RELICS_ADDRESS = (process.env.NEXT_PUBLIC_RELICS_ADDRESS || undefined) as Address | undefined;
export const DEPLOY_BLOCK = BigInt(process.env.NEXT_PUBLIC_DEPLOY_BLOCK || '0');

export const publicClient = createPublicClient({ chain: CHAIN, transport: http() });

export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addressUrl = (a: string) => `${EXPLORER}/address/${a}`;

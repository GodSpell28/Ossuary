import { createPublicClient, http, type Address } from 'viem';
import { avalanche, avalancheFuji } from 'viem/chains';

/** 'fuji' (default) or 'mainnet'. Contract addresses must match the network. */
export const NETWORK: 'fuji' | 'mainnet' = process.env.NEXT_PUBLIC_NETWORK === 'mainnet' ? 'mainnet' : 'fuji';
export const CHAIN = NETWORK === 'mainnet' ? avalanche : avalancheFuji;
export const EXPLORER = NETWORK === 'mainnet' ? 'https://snowtrace.io' : 'https://testnet.snowtrace.io';
/** SmoothSend's name for the network. */
export const SMOOTHSEND_NETWORK = NETWORK === 'mainnet' ? 'mainnet' : 'testnet';

export const SMOOTHSEND_KEY = process.env.NEXT_PUBLIC_SMOOTHSEND_KEY ?? '';
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '';
export const GAME_ADDRESS = (process.env.NEXT_PUBLIC_GAME_ADDRESS || undefined) as Address | undefined;
export const RELICS_ADDRESS = (process.env.NEXT_PUBLIC_RELICS_ADDRESS || undefined) as Address | undefined;
export const DEPLOY_BLOCK = BigInt(process.env.NEXT_PUBLIC_DEPLOY_BLOCK || '0');

export const publicClient = createPublicClient({ chain: CHAIN, transport: http() });

export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addressUrl = (a: string) => `${EXPLORER}/address/${a}`;

export const VERIFIER_URL = process.env.NEXT_PUBLIC_VERIFIER_URL || 'http://localhost:8787';

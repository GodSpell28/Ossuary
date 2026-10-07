// Sends one sponsored startRun from a throwaway smart account, to prove the
// SmoothSend key, paymaster and bundler work without Privy in the loop.
//   node --env-file=.env.local scripts/smoke-sponsored.mts
import { createSmoothSendAvaxClient } from '@smoothsend/sdk/avax';
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji } from 'viem/chains';

const game = process.env.NEXT_PUBLIC_GAME_ADDRESS as `0x${string}`;
const abi = parseAbi(['function today() view returns (uint32)', 'function startRun(uint32 day) returns (uint256)', 'function openRunOf(address) view returns (uint256)']);
const publicClient = createPublicClient({ chain: avalancheFuji, transport: http() });
const account = privateKeyToAccount(generatePrivateKey());
const walletClient = createWalletClient({ account, chain: avalancheFuji, transport: http() });

const client = createSmoothSendAvaxClient({
  apiKey: process.env.NEXT_PUBLIC_SMOOTHSEND_KEY!,
  network: 'testnet',
  corsOrigin: 'http://localhost:3000',
  publicClient: publicClient as never,
  walletClient: walletClient as never,
});

const day = await publicClient.readContract({ address: game, abi, functionName: 'today' });
console.log('owner', account.address, 'day', day);
const t0 = Date.now();
const res = await client.submitCall({
  call: { to: game, data: encodeFunctionData({ abi, functionName: 'startRun', args: [day] }) },
  mode: 'developer-sponsored',
  waitForReceipt: true,
});
const sender = res.receipt?.sender as `0x${string}`;
console.log('userOp ', res.userOpHash);
console.log('tx     ', res.transactionHash, `(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
console.log('success', res.receipt?.success, 'smart account', sender);
console.log('openRunOf(smart account) =', await publicClient.readContract({ address: game, abi, functionName: 'openRunOf', args: [sender] }));
console.log('smart account AVAX =', await publicClient.getBalance({ address: sender }));

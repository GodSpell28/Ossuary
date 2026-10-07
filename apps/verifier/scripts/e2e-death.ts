// End to end, no browser: a throwaway player opens a run, dies in a scripted
// replay, asks the running verifier to sign the death, and records the grave
// through SmoothSend. Prints every hop.
//   pnpm --filter @ossuary/verifier e2e   (verifier must be running on :8787)
import { readFileSync } from 'node:fs';
import { createSmoothSendAvaxClient } from '@smoothsend/sdk/avax';
import { STAND_AND_DIE, inputsToBase64, levelForDay, playScript } from '@ossuary/sim';
import { config } from 'dotenv';
import { createPublicClient, createWalletClient, decodeEventLog, encodeFunctionData, hexToString, http, parseAbi, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji } from 'viem/chains';

config();
const game = JSON.parse(readFileSync('../../packages/contracts/deployments/fuji.json', 'utf8')).game as Hex;
const abi = parseAbi([
  'function today() view returns (uint32)',
  'function startRun(uint32 day) returns (uint256)',
  'function recordDeath(uint256 runId, uint16 tile, bytes32 epitaph, uint8 relicId, bytes sig) returns (uint256)',
  'function gravesOf(uint32 day, uint256 offset, uint256 limit) view returns (uint256[] ids, (address player, uint32 day, uint16 tile, uint8 relicId, bool looted, bytes32 epitaph)[] graves)',
  'event RunStarted(uint256 indexed runId, address indexed player, uint32 indexed day)',
  'event GraveDug(uint256 indexed graveId, address indexed player, uint32 indexed day, uint16 tile, uint8 relicId, bytes32 epitaph)',
]);
const pc = createPublicClient({ chain: avalancheFuji, transport: http() });
const owner = privateKeyToAccount(generatePrivateKey());
const ss = createSmoothSendAvaxClient({
  // Server-side secret key: no browser Origin needed.
  apiKey: process.env.SMOOTHSEND_SECRET_KEY!,
  network: 'testnet',
  publicClient: pc as never,
  walletClient: createWalletClient({ account: owner, chain: avalancheFuji, transport: http() }) as never,
});

async function send(label: string, data: Hex) {
  const t0 = Date.now();
  const r = await ss.submitCall({ call: { to: game, data }, mode: 'developer-sponsored', waitForReceipt: false });
  const t1 = Date.now();
  const receipt = await ss.submitter.waitForUserOperationReceipt(r.userOpHash, { pollMs: 250 });
  const t2 = Date.now();
  const hash = receipt!.receipt.transactionHash as Hex;
  console.log(`${label}: tx ${hash}; build+sign+submit ${((t1 - t0) / 1000).toFixed(1)} s, then mined after ${((t2 - t1) / 1000).toFixed(1)} s, success ${receipt?.success}`);
  return pc.getTransactionReceipt({ hash });
}

const day = await pc.readContract({ address: game, abi, functionName: 'today' });
console.log(`owner ${owner.address}, day ${day}`);

// 1. Open a run.
const startRc = await send('startRun', encodeFunctionData({ abi, functionName: 'startRun', args: [day] }));
const started = startRc.logs.map((l) => { try { return decodeEventLog({ abi, ...l }); } catch { return null; } }).find((e) => e?.eventName === 'RunStarted');
const runId = (started!.args as { runId: bigint; player: Hex }).runId;
const player = (started!.args as { player: Hex }).player;
console.log(`run ${runId} for smart account ${player}`);

// 2. Play: open the crypt door, walk into the bone hall and stand there until killed.
const level = levelForDay(day);
const { state: s, inputs } = playScript(level, day, STAND_AND_DIE);
console.log(`died at tick ${s.player.diedAt}, ${inputs.length} inputs`);

// 3. Verifier replays and signs.
const t0 = Date.now();
const res = await fetch(`${process.env.VERIFIER_URL ?? 'http://localhost:8787'}/verify/death`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
  body: JSON.stringify({ runId: runId.toString(), player, inputs: inputsToBase64(inputs), epitaph: 'e2e test: stood in the duct', relicId: 0 }),
});
const v = await res.json();
if (!res.ok) throw new Error(`verifier: ${v.error}`);
console.log(`verifier signed tile ${v.tile} in ${Date.now() - t0} ms`);

// 4. Record the grave.
const deathRc = await send('recordDeath', encodeFunctionData({ abi, functionName: 'recordDeath', args: [runId, v.tile, v.epitaph, 0, v.signature] }));
const dug = deathRc.logs.map((l) => { try { return decodeEventLog({ abi, ...l }); } catch { return null; } }).find((e) => e?.eventName === 'GraveDug');
console.log('GraveDug', dug?.args);

const [ids, graves] = await pc.readContract({ address: game, abi, functionName: 'gravesOf', args: [day, 0n, 50n] });
console.log(`graves today: ${ids.length}; latest: tile ${graves.at(-1)!.tile} "${hexToString(graves.at(-1)!.epitaph, { size: 32 })}"`);

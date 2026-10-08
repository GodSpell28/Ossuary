// End to end on Fuji, no browser, two throwaway players:
//   1. A escapes the level (bot inputs, verified) and is minted a relic
//   2. A descends again carrying that relic and dies: the relic is buried
//   3. B opens a run and loots A's grave: the relic moves to B
//   VERIFIER_URL=https://... pnpm --filter @ossuary/verifier e2e:loot
import { readFileSync } from 'node:fs';
import { createSmoothSendAvaxClient } from '@smoothsend/sdk/avax';
import { SIM_FINGERPRINT, STAND_AND_DIE, inputsToBase64, levelForDay, playBot, playScript } from '@ossuary/sim';
import { config } from 'dotenv';
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  http,
  parseAbi,
  type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji } from 'viem/chains';

config();
const VERIFIER = process.env.VERIFIER_URL ?? 'http://localhost:8787';
const d = JSON.parse(readFileSync('../../packages/contracts/deployments/fuji.json', 'utf8'));
const game = d.game as Hex;
const relics = d.relics as Hex;
const abi = parseAbi([
  'function today() view returns (uint32)',
  'function startRun(uint32 day) returns (uint256)',
  'function finishRun(uint256 runId, uint32 timeMs, uint16 kills, bytes32 replayHash, bytes sig) returns (uint8)',
  'function recordDeath(uint256 runId, uint16 tile, bytes32 epitaph, uint8 relicId, bytes sig) returns (uint256)',
  'function lootGrave(uint256 graveId)',
  'function grave(uint256) view returns ((address player, uint32 day, uint16 tile, uint8 relicId, bool looted, bytes32 epitaph))',
  'event RunStarted(uint256 indexed runId, address indexed player, uint32 indexed day)',
  'event RunFinished(uint256 indexed runId, address indexed player, uint32 indexed day, uint32 timeMs, uint16 kills, uint8 relicMinted)',
  'event GraveDug(uint256 indexed graveId, address indexed player, uint32 indexed day, uint16 tile, uint8 relicId, bytes32 epitaph)',
  'event GraveLooted(uint256 indexed graveId, address indexed looter, uint8 relicId)',
]);
const relicsAbi = parseAbi(['function balanceOf(address, uint256) view returns (uint256)']);
const pc = createPublicClient({ chain: avalancheFuji, transport: http() });
const tx = (h: string) => `https://testnet.snowtrace.io/tx/${h}`;

function player(name: string) {
  const owner = privateKeyToAccount(generatePrivateKey());
  const ss = createSmoothSendAvaxClient({
    apiKey: process.env.SMOOTHSEND_SECRET_KEY!,
    network: 'testnet',
    publicClient: pc as never,
    walletClient: createWalletClient({ account: owner, chain: avalancheFuji, transport: http() }) as never,
  });
  let account: Hex | null = null;
  const send = async (label: string, functionName: string, args: unknown[]) => {
    const data = encodeFunctionData({ abi, functionName, args } as never);
    const sent = await ss.submitCall({ call: { to: game, data }, mode: 'developer-sponsored', waitForReceipt: false });
    const r = await ss.submitter.waitForUserOperationReceipt(sent.userOpHash, { pollMs: 250 });
    if (!r?.success) throw new Error(`${name} ${label} failed: ${r?.reason ?? 'no receipt'}`);
    const hash = r.receipt.transactionHash as Hex;
    account = r.sender as Hex;
    const rc = await pc.getTransactionReceipt({ hash });
    const events = rc.logs.flatMap((l) => {
      try {
        return [decodeEventLog({ abi, ...l })];
      } catch {
        return [];
      }
    });
    console.log(`  ${name} ${label}: ${tx(hash)}`);
    return events as { eventName: string; args: Record<string, unknown> }[];
  };
  return { name, send, get account() { return account!; } };
}

async function verify(kind: 'death' | 'finish', body: object) {
  const res = await fetch(`${VERIFIER}/verify/${kind}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify({ ...body, sim: SIM_FINGERPRINT }),
  });
  const v = await res.json();
  if (!res.ok) throw new Error(`verifier: ${v.error}`);
  return v;
}

const day = await pc.readContract({ address: game, abi, functionName: 'today' });
const level = levelForDay(day);
console.log(`day ${day}, verifier ${VERIFIER}`);

// Find a bot run that escapes today's layout.
let bot = null;
search: for (const engage of [9, 11, 13, 8, 14, 10, 12]) {
  for (let delay = 0; delay <= 150; delay += 6) {
    const r = playBot(level, day, { engage, delay });
    if (r.outcome === 'finish') {
      bot = r;
      break search;
    }
  }
}
if (!bot) throw new Error('no bot run escaped today; try again tomorrow');
console.log(`bot escape found: ${(bot.state.tick / 60).toFixed(1)} s, ${bot.state.player.kills} kills`);

// 1. A escapes and is minted a relic.
const A = player('A');
console.log('1. A escapes');
let ev = await A.send('startRun', 'startRun', [day]);
let runId = ev.find((e) => e.eventName === 'RunStarted')!.args.runId as bigint;
const fin = await verify('finish', { runId: runId.toString(), player: A.account, inputs: inputsToBase64(bot.inputs) });
console.log(`  verifier signed: ${fin.timeMs} ms, ${fin.kills} kills`);
ev = await A.send('finishRun', 'finishRun', [runId, fin.timeMs, fin.kills, fin.replayHash, fin.signature]);
const relicId = Number(ev.find((e) => e.eventName === 'RunFinished')!.args.relicMinted);
console.log(`  A now holds relic ${relicId}: ${await pc.readContract({ address: relics, abi: relicsAbi, functionName: 'balanceOf', args: [A.account, BigInt(relicId)] })}`);

// 2. A dies carrying it; the relic goes into the grave.
console.log('2. A dies carrying the relic');
await new Promise((r) => setTimeout(r, 11_000)); // startRun cooldown
ev = await A.send('startRun', 'startRun', [day]);
runId = ev.find((e) => e.eventName === 'RunStarted')!.args.runId as bigint;
const death = playScript(level, day, STAND_AND_DIE, { relic: relicId });
const dv = await verify('death', {
  runId: runId.toString(),
  player: A.account,
  inputs: inputsToBase64(death.inputs),
  epitaph: 'took a relic to the grave',
  relicId,
});
ev = await A.send('recordDeath', 'recordDeath', [runId, dv.tile, dv.epitaph, relicId, dv.signature]);
const graveId = ev.find((e) => e.eventName === 'GraveDug')!.args.graveId as bigint;
console.log(`  grave ${graveId} at tile ${dv.tile} holds relic ${relicId}; A's balance now ${await pc.readContract({ address: relics, abi: relicsAbi, functionName: 'balanceOf', args: [A.account, BigInt(relicId)] })}`);

// 3. B loots it.
console.log('3. B loots the grave');
const B = player('B');
await B.send('startRun', 'startRun', [day]);
ev = await B.send('lootGrave', 'lootGrave', [graveId]);
const looted = ev.find((e) => e.eventName === 'GraveLooted');
const g = await pc.readContract({ address: game, abi, functionName: 'grave', args: [graveId] });
const bBal = await pc.readContract({ address: relics, abi: relicsAbi, functionName: 'balanceOf', args: [B.account, BigInt(relicId)] });
console.log(`  GraveLooted relic ${looted?.args.relicId}; grave looted=${g.looted}; B holds relic ${relicId}: ${bBal}`);
console.log(bBal === 1n && g.looted ? 'LOOT FLOW OK' : 'LOOT FLOW FAILED');

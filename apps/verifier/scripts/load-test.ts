// Disclosed load test: a pool of bot players makes real, verified game
// transactions through SmoothSend until a target count is reached.
//
// Each cycle a wallet opens a run, maybe loots another bot's relic grave,
// plays the level with the built-in bot (escape or death, as it happens),
// gets the result signed by the verifier and records it. Bots carry relics
// they hold into the next run, so graves hold relics for others to loot.
//
// Every bot is labelled: epitaphs read "[load test]" and the smart-account
// addresses are published in apps/client/chain/loadTestWallets.json, which the
// leaderboard uses to keep bots out of the main ranking. Owner keys stay in a
// gitignored local file so the same 30 wallets are reused across restarts.
//
//   NETWORK=mainnet VERIFIER_URL=https://... TARGET=400 POOL=30 CONCURRENCY=4 \
//     pnpm --filter @ossuary/verifier load-test
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createSmoothSendAvaxClient } from '@smoothsend/sdk/avax';
import { SIM_FINGERPRINT, STAND_AND_DIE, inputsToBase64, levelForDay, playBot, playScript } from '@ossuary/sim';
import { config } from 'dotenv';
import { createPublicClient, createWalletClient, decodeEventLog, encodeFunctionData, http, parseAbi, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { avalanche, avalancheFuji } from 'viem/chains';

config();
const MAINNET = (process.env.NETWORK ?? 'mainnet') === 'mainnet';
const chain = MAINNET ? avalanche : avalancheFuji;
const VERIFIER = (process.env.VERIFIER_URL ?? 'https://ossuaryverifier-production.up.railway.app').replace(/\/+$/, '');
const TARGET = Number(process.env.TARGET ?? 400);
const POOL = Number(process.env.POOL ?? 30);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 2);
const EXPLORER = MAINNET ? 'https://snowtrace.io' : 'https://testnet.snowtrace.io';
const deployments = JSON.parse(readFileSync(`../../packages/contracts/deployments/${MAINNET ? 'avalanche' : 'fuji'}.json`, 'utf8'));
const GAME = deployments.game as Hex;
const KEYS_FILE = `.load-test-wallets.${MAINNET ? 'mainnet' : 'fuji'}.json`;
const LOG_FILE = `load-test-log.${MAINNET ? 'mainnet' : 'fuji'}.jsonl`;
const PUBLIC_LIST = '../client/chain/loadTestWallets.json';
const EPITAPH = '[load test]';

const abi = parseAbi([
  'function today() view returns (uint32)',
  'function startRun(uint32 day) returns (uint256)',
  'function finishRun(uint256 runId, uint32 timeMs, uint16 kills, bytes32 replayHash, bytes sig) returns (uint8)',
  'function recordDeath(uint256 runId, uint16 tile, bytes32 epitaph, uint8 relicId, bytes sig) returns (uint256)',
  'function lootGrave(uint256 graveId)',
  'event RunStarted(uint256 indexed runId, address indexed player, uint32 indexed day)',
  'event RunFinished(uint256 indexed runId, address indexed player, uint32 indexed day, uint32 timeMs, uint16 kills, uint8 relicMinted)',
  'event GraveDug(uint256 indexed graveId, address indexed player, uint32 indexed day, uint16 tile, uint8 relicId, bytes32 epitaph)',
  'event GraveLooted(uint256 indexed graveId, address indexed looter, uint8 relicId)',
]);
const pc = createPublicClient({ chain, transport: http() });

// ---- wallet pool ----
const keys: Hex[] = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : [];
while (keys.length < POOL) keys.push(generatePrivateKey());
writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));

interface Bot {
  index: number;
  busy: boolean;
  /** Earliest time this wallet may be used again (after a nonce clash). */
  readyAt: number;
  send(label: string, fn: string, args: unknown[]): Promise<{ hash: Hex; events: { eventName: string; args: any }[] }>;
  account: Hex | null;
  relics: number[];
}

function makeBot(index: number, key: Hex): Bot {
  const owner = privateKeyToAccount(key);
  const ss = createSmoothSendAvaxClient({
    apiKey: process.env.SMOOTHSEND_SECRET_KEY!,
    network: MAINNET ? 'mainnet' : 'testnet',
    publicClient: pc as never,
    walletClient: createWalletClient({ account: owner, chain, transport: http() }) as never,
  });
  const bot: Bot = {
    index,
    busy: false,
    readyAt: 0,
    account: null,
    relics: [],
    async send(label, functionName, args) {
      const data = encodeFunctionData({ abi, functionName, args } as never);
      const sent = await ss.submitCall({ call: { to: GAME, data }, mode: 'developer-sponsored', waitForReceipt: false });
      const r = await ss.submitter.waitForUserOperationReceipt(sent.userOpHash, { pollMs: 1500, timeoutMs: 120_000 });
      if (!r) throw new Error(`${label}: not mined in 90 s`);
      if (!r.success) throw new Error(`${label}: reverted ${r.reason ?? ''}`);
      bot.account = r.sender as Hex;
      const hash = r.receipt.transactionHash as Hex;
      const rc = await pc.getTransactionReceipt({ hash });
      const events = rc.logs.flatMap((l) => {
        try {
          return [decodeEventLog({ abi, ...l }) as { eventName: string; args: any }];
        } catch {
          return [];
        }
      });
      record({ bot: index, account: bot.account, action: label, tx: hash });
      return { hash, events };
    },
  };
  return bot;
}

// ---- progress, resumable ----
let done = existsSync(LOG_FILE) ? readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean).length : 0;
const accounts = new Set<string>(
  existsSync(LOG_FILE) ? readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).account) : [],
);

function record(entry: { bot: number; account: string; action: string; tx: string }) {
  done++;
  appendFileSync(LOG_FILE, JSON.stringify({ ...entry, at: new Date().toISOString() }) + '\n');
  if (!accounts.has(entry.account)) {
    accounts.add(entry.account);
    publishList();
  }
  console.log(`[${String(done).padStart(3)}/${TARGET}] bot ${String(entry.bot).padStart(2)} ${entry.action.padEnd(11)} ${EXPLORER}/tx/${entry.tx}`);
}

function publishList() {
  const prev = existsSync(PUBLIC_LIST) ? JSON.parse(readFileSync(PUBLIC_LIST, 'utf8')) : {};
  const list = { ...prev, [MAINNET ? 'mainnet' : 'fuji']: [...accounts].sort() };
  writeFileSync(PUBLIC_LIST, JSON.stringify(list, null, 2) + '\n');
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

// Relic graves dug by bots and not yet looted, for other bots to take.
const lootable: { graveId: bigint; owner: number }[] = [];

async function cycle(bot: Bot, day: number) {
  const level = levelForDay(day);
  const ev = await bot.send('startRun', 'startRun', [day]);
  const runId = ev.events.find((e) => e.eventName === 'RunStarted')!.args.runId as bigint;

  // Take a relic from another bot's grave when one is waiting.
  const gi = lootable.findIndex((g) => g.owner !== bot.index);
  if (gi >= 0 && done < TARGET) {
    const g = lootable.splice(gi, 1)[0];
    const l = await bot.send('lootGrave', 'lootGrave', [g.graveId]);
    const got = l.events.find((e) => e.eventName === 'GraveLooted');
    if (got && Number(got.args.relicId) > 0) bot.relics.push(Number(got.args.relicId));
  }

  // Play: carry a held relic, let the bot try the level with random settings.
  const relic = bot.relics[0] ?? 0;
  const r = playBot(level, day, {
    relic,
    engage: 8 + Math.floor(Math.random() * 7),
    delay: Math.floor(Math.random() * 25) * 6,
  });
  const inputs = r.outcome === 'timeout' ? playScript(level, day, STAND_AND_DIE, { relic }).inputs : r.inputs;
  const player = bot.account!;

  if (r.outcome === 'finish') {
    const v = await verify('finish', { runId: runId.toString(), player, inputs: inputsToBase64(inputs), relicId: relic });
    const f = await bot.send('finishRun', 'finishRun', [runId, v.timeMs, v.kills, v.replayHash, v.signature]);
    const minted = Number(f.events.find((e) => e.eventName === 'RunFinished')?.args.relicMinted ?? 0);
    if (minted) bot.relics.push(minted);
  } else {
    const v = await verify('death', { runId: runId.toString(), player, inputs: inputsToBase64(inputs), epitaph: EPITAPH, relicId: relic });
    const d = await bot.send('recordDeath', 'recordDeath', [runId, v.tile, v.epitaph, relic, v.signature]);
    if (relic) {
      bot.relics.shift();
      const dug = d.events.find((e) => e.eventName === 'GraveDug');
      if (dug) lootable.push({ graveId: dug.args.graveId as bigint, owner: bot.index });
    }
  }
}

// ---- main ----
const info = await (await fetch(`${VERIFIER}/`)).json();
const expected = MAINNET ? 'avalanche' : 'fuji';
if (info.network !== expected || info.game?.toLowerCase() !== GAME.toLowerCase()) {
  throw new Error(`verifier at ${VERIFIER} is on ${info.network} / ${info.game}, expected ${expected} / ${GAME}`);
}
if (info.sim !== SIM_FINGERPRINT) throw new Error(`verifier rules ${info.sim} differ from local ${SIM_FINGERPRINT}`);
const day = Number(await pc.readContract({ address: GAME, abi, functionName: 'today' }));
console.log(`${expected} · game ${GAME} · day ${day} · pool ${POOL} · concurrency ${CONCURRENCY} · ${done}/${TARGET} done`);

const bots = keys.map((k, i) => makeBot(i, k));
let next = 0;
let failures = 0;
let backoff = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Next wallet that is idle and not cooling down, round robin. */
async function claim(): Promise<Bot> {
  for (;;) {
    for (let k = 0; k < bots.length; k++) {
      const b = bots[next++ % bots.length];
      if (!b.busy && Date.now() >= b.readyAt) {
        b.busy = true;
        return b;
      }
    }
    await sleep(1000);
  }
}

async function worker() {
  while (done < TARGET && failures < 10) {
    const bot = await claim();
    try {
      await cycle(bot, day);
      failures = 0;
      backoff = 0;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/rate limit/i.test(msg)) {
        // The gateway is asking us to slow down: wait, longer each time, and
        // do not count it as a failure.
        backoff = Math.min(120_000, backoff ? backoff * 2 : 20_000);
        console.log(`  rate limited; pausing ${backoff / 1000} s`);
        await sleep(backoff);
      } else {
        failures++;
        if (/nonce/i.test(msg)) bot.readyAt = Date.now() + 60_000;
        console.log(`  bot ${bot.index} failed (${failures} in a row): ${msg.slice(0, 160)}`);
        await sleep(5000);
      }
    } finally {
      bot.busy = false;
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(failures >= 10 ? 'stopped after 10 failures in a row' : `target reached: ${done} transactions from ${accounts.size} bot wallets`);

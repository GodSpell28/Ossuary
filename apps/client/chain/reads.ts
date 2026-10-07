import type { Address, Hex } from 'viem';
import { ossuaryGameAbi } from './abi';
import { DEPLOY_BLOCK, GAME_ADDRESS, publicClient } from './config';

// Public reads that need no login: anyone can see the day's leaderboard.

export interface LeaderboardRow {
  player: Address;
  timeMs: number;
  kills: number;
  runId: bigint;
  txHash: Hex;
}

export async function fetchToday(): Promise<number> {
  if (!GAME_ADDRESS) throw new Error('NEXT_PUBLIC_GAME_ADDRESS is not set');
  return Number(await publicClient.readContract({ address: GAME_ADDRESS, abi: ossuaryGameAbi, functionName: 'today' }));
}

/** Best verified time per player for a day, fastest first, from RunFinished events. */
export async function fetchLeaderboard(day: number): Promise<LeaderboardRow[]> {
  if (!GAME_ADDRESS) throw new Error('NEXT_PUBLIC_GAME_ADDRESS is not set');
  const latest = await publicClient.getBlockNumber();
  const event = ossuaryGameAbi.find((x) => x.type === 'event' && x.name === 'RunFinished')!;
  // Public RPCs cap getLogs at 2048 blocks; fetch the range in parallel chunks.
  const ranges: [bigint, bigint][] = [];
  for (let from = DEPLOY_BLOCK; from <= latest; from += 2048n) {
    ranges.push([from, from + 2047n > latest ? latest : from + 2047n]);
  }
  const best = new Map<string, LeaderboardRow>();
  for (let i = 0; i < ranges.length; i += 6) {
    const batch = await Promise.all(
      ranges.slice(i, i + 6).map(([fromBlock, toBlock]) =>
        publicClient.getLogs({ address: GAME_ADDRESS!, event: event as never, args: { day } as never, fromBlock, toBlock }),
      ),
    );
    type Log = { args: { player: Address; timeMs: number; kills: number; runId: bigint }; transactionHash: Hex };
    for (const log of batch.flat() as unknown as Log[]) {
      const { player, timeMs, kills, runId } = log.args;
      const prev = best.get(player.toLowerCase());
      if (!prev || timeMs < prev.timeMs) best.set(player.toLowerCase(), { player, timeMs, kills, runId, txHash: log.transactionHash });
    }
  }
  return [...best.values()].sort((a, b) => a.timeMs - b.timeMs);
}

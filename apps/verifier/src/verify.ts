import { SIM_FINGERPRINT, inputsFromBase64, levelForDay, replay } from '@ossuary/sim';
import { isAddress, keccak256, stringToHex, toHex, type Address, type Hex, type LocalAccount } from 'viem';

// Checks a claimed run outcome by replaying its input log through the same
// simulation the client ran, then signs the EIP-712 message OssuaryGame
// expects. The tile, kills and time in the signature come from the replay,
// never from the client.

export interface RunInfo {
  player: Address;
  day: number;
  open: boolean;
}

export interface VerifyDeps {
  signer: LocalAccount;
  chainId: number;
  game: Address;
  readRun(runId: bigint): Promise<RunInfo>;
  /** How many of a relic type the player holds right now. */
  readRelicBalance(player: Address, relicId: number): Promise<bigint>;
}

export class VerifyError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** About 30 minutes of input at 60 Hz. */
const MAX_TICKS = 60 * 60 * 30;

function domain(d: VerifyDeps) {
  return { name: 'Ossuary', version: '1', chainId: d.chainId, verifyingContract: d.game } as const;
}

function parseRelic(raw: unknown): number {
  const relicId = Number(raw ?? 0);
  if (!Number.isInteger(relicId) || relicId < 0 || relicId > 6) throw new VerifyError('relicId must be 0-6');
  return relicId;
}

/** Message the client shows when its rules differ from the verifier's. */
export const OUTDATED = 'the game was updated since this page loaded; reload the page to play the current version';

async function checkRun(
  d: VerifyDeps,
  body: Record<string, unknown>,
  relicId: number,
) {
  const { runId: runIdRaw, player: playerRaw, inputs: inputsRaw } = body;
  // Older clients send no fingerprint; a mismatched one can never replay.
  if (body.sim !== undefined && body.sim !== SIM_FINGERPRINT) throw new VerifyError(OUTDATED, 409);
  if (typeof runIdRaw !== 'string' || !/^\d+$/.test(runIdRaw)) throw new VerifyError('runId must be a decimal string');
  if (typeof playerRaw !== 'string' || !isAddress(playerRaw)) throw new VerifyError('player must be an address');
  if (typeof inputsRaw !== 'string') throw new VerifyError('inputs must be base64');
  const runId = BigInt(runIdRaw);
  const player = playerRaw as Address;

  const run = await d.readRun(runId);
  if (run.player.toLowerCase() !== player.toLowerCase()) throw new VerifyError('run belongs to another player', 403);
  if (!run.open) throw new VerifyError('run is already closed', 409);

  let inputs: Int32Array;
  try {
    inputs = inputsFromBase64(inputsRaw);
  } catch {
    throw new VerifyError('inputs are not a valid log');
  }
  if (inputs.length === 0 || inputs.length > MAX_TICKS) throw new VerifyError('input log length out of range');
  // A relic changes the simulation, so the claimed one must really be held.
  if (relicId > 0 && (await d.readRelicBalance(player, relicId)) === 0n) {
    throw new VerifyError(`player does not hold relic ${relicId}`, 403);
  }

  const result = replay(levelForDay(run.day), run.day, inputs, relicId);
  const replayHash = keccak256(toHex(new Uint8Array(inputs.buffer, inputs.byteOffset, inputs.byteLength)));
  return { runId, player, run, result, replayHash };
}

/** Explains a replay that ended differently from the client's claim. */
function mismatch(expected: string, r: { outcome: string; ticks: number }, body: Record<string, unknown>): string {
  const claimed = typeof body.ticks === 'number' ? ` (client ran ${body.ticks} ticks)` : '';
  const ended = r.outcome === 'incomplete' ? 'never ended' : `ended in a ${r.outcome}`;
  return `replay does not reach ${expected}: it ${ended} after ${r.ticks} ticks${claimed}`;
}

/** Epitaphs are short text packed into bytes32. */
export function packEpitaph(text: unknown): Hex {
  const t = typeof text === 'string' ? text.trim().replace(/\s+/g, ' ') : '';
  const bytes = new TextEncoder().encode(t);
  if (bytes.length > 32) throw new VerifyError('epitaph is longer than 32 bytes');
  return stringToHex(t, { size: 32 });
}

export async function verifyDeath(d: VerifyDeps, body: Record<string, unknown>) {
  const relicId = parseRelic(body.relicId);
  const { runId, player, result, replayHash } = await checkRun(d, body, relicId);
  if (result.outcome !== 'death') throw new VerifyError(mismatch('a death', result, body), 422);
  const epitaph = packEpitaph(body.epitaph);
  const tile = result.tile;

  const signature = await d.signer.signTypedData({
    domain: domain(d),
    types: {
      Death: [
        { name: 'runId', type: 'uint256' },
        { name: 'player', type: 'address' },
        { name: 'tile', type: 'uint16' },
        { name: 'epitaph', type: 'bytes32' },
        { name: 'relicId', type: 'uint8' },
      ],
    },
    primaryType: 'Death',
    message: { runId, player, tile, epitaph, relicId },
  });
  return { runId: runId.toString(), tile, epitaph, relicId, signature, replayHash, ticks: result.ticks };
}

export async function verifyFinish(d: VerifyDeps, body: Record<string, unknown>) {
  const relicId = parseRelic(body.relicId);
  const { runId, player, result, replayHash } = await checkRun(d, body, relicId);
  if (result.outcome !== 'finish') throw new VerifyError(mismatch('the exit', result, body), 422);
  const { timeMs, kills } = result;

  const signature = await d.signer.signTypedData({
    domain: domain(d),
    types: {
      Finish: [
        { name: 'runId', type: 'uint256' },
        { name: 'player', type: 'address' },
        { name: 'timeMs', type: 'uint32' },
        { name: 'kills', type: 'uint16' },
        { name: 'replayHash', type: 'bytes32' },
      ],
    },
    primaryType: 'Finish',
    message: { runId, player, timeMs, kills, replayHash },
  });
  return { runId: runId.toString(), timeMs, kills, replayHash, signature, ticks: result.ticks };
}

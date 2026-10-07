import {
  createSmoothSendAvaxClient,
  fetchAvaxAaPublicDefaults,
  predictSimpleAccountAddress,
  type SmoothSendAvaxClient,
} from '@smoothsend/sdk/avax';
import { decodeEventLog, encodeFunctionData, type Address, type Hex, type WalletClient } from 'viem';
import { ossuaryGameAbi, relicsAbi } from './abi';
import { GAME_ADDRESS, NETWORK, RELICS_ADDRESS, SMOOTHSEND_KEY, SMOOTHSEND_NETWORK, publicClient } from './config';

// Turns game actions into sponsored ERC-4337 operations. The engine never
// waits on this: it fires actions and listens for status updates.
//
// Writes go through one serial queue because every operation from a smart
// account is ordered by its EntryPoint nonce; two in flight would collide.

/** queued: waiting behind earlier writes. signing: building, signing and handing
 * the UserOperation to SmoothSend. submitted: the bundler has it. confirmed:
 * mined on Fuji. */
export type TxState = 'queued' | 'signing' | 'submitted' | 'confirmed' | 'failed';

export interface TxStatus {
  id: number;
  label: string;
  state: TxState;
  userOpHash?: string;
  txHash?: string;
  error?: string;
  startedAt: number;
  ms?: number;
}

type GameFn = 'startRun' | 'recordDeath' | 'finishRun' | 'lootGrave';

export interface Grave {
  id: bigint;
  player: Address;
  day: number;
  tile: number;
  relicId: number;
  looted: boolean;
  epitaph: Hex;
}

export class ChainLayer {
  private queue: Promise<unknown> = Promise.resolve();
  private nextId = 1;
  private listeners = new Set<(s: TxStatus) => void>();

  private constructor(
    private readonly client: SmoothSendAvaxClient,
    readonly owner: Address,
    readonly smartAccount: Address,
  ) {}

  /** `walletClient` must wrap the player's embedded wallet; it signs UserOp hashes. */
  static async create(walletClient: WalletClient, owner: Address): Promise<ChainLayer> {
    if (!SMOOTHSEND_KEY) throw new Error('NEXT_PUBLIC_SMOOTHSEND_KEY is not set');
    const defaults = await fetchAvaxAaPublicDefaults();
    const factory = NETWORK === 'mainnet' ? defaults.simpleAccountFactoryMainnet : defaults.simpleAccountFactoryFuji;
    if (!factory) throw new Error(`SmoothSend did not return an account factory for ${NETWORK}`);
    const smartAccount = await predictSimpleAccountAddress({ publicClient, factory, owner, salt: 0n });
    const client = createSmoothSendAvaxClient({
      apiKey: SMOOTHSEND_KEY,
      network: SMOOTHSEND_NETWORK,
      publicClient,
      walletClient,
      ownerAddress: owner,
      accountFactory: factory,
      accountSalt: 0n,
    });
    return new ChainLayer(client, owner, smartAccount);
  }

  onStatus(fn: (s: TxStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Reads today's day number from the contract, so client and chain agree. */
  async today(): Promise<number> {
    return Number(await publicClient.readContract({ address: game(), abi: ossuaryGameAbi, functionName: 'today' }));
  }

  /** Every grave dug on a day, oldest first. */
  async graves(day: number): Promise<Grave[]> {
    const out: Grave[] = [];
    for (let offset = 0n; ; offset += 200n) {
      const [ids, gs] = await publicClient.readContract({
        address: game(),
        abi: ossuaryGameAbi,
        functionName: 'gravesOf',
        args: [day, offset, 200n],
      });
      gs.forEach((g, i) => out.push({ id: ids[i], ...g }));
      if (ids.length < 200) return out;
    }
  }

  /** How many of each relic type (1-6) this player holds. */
  async relics(): Promise<number[]> {
    if (!RELICS_ADDRESS) return [0, 0, 0, 0, 0, 0];
    const ids = [1n, 2n, 3n, 4n, 5n, 6n];
    const bal = await publicClient.readContract({
      address: RELICS_ADDRESS,
      abi: relicsAbi,
      functionName: 'balanceOfBatch',
      args: [ids.map(() => this.smartAccount), ids],
    });
    return bal.map(Number);
  }

  async openRun(): Promise<bigint> {
    return publicClient.readContract({
      address: game(),
      abi: ossuaryGameAbi,
      functionName: 'openRunOf',
      args: [this.smartAccount],
    });
  }

  /** Opens a run and resolves with its run ID once mined. */
  async startRun(day: number): Promise<{ runId: bigint; txHash: string }> {
    const { txHash } = await this.write('Start run', 'startRun', [day]);
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash as Hex });
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== game().toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: ossuaryGameAbi, ...log });
        if (ev.eventName === 'RunStarted') return { runId: ev.args.runId, txHash };
      } catch {
        // not one of ours
      }
    }
    throw new Error('RunStarted event not found in receipt');
  }

  recordDeath(runId: bigint, tile: number, epitaph: Hex, relicId: number, sig: Hex) {
    return this.write('Record death', 'recordDeath', [runId, tile, epitaph, relicId, sig]);
  }

  finishRun(runId: bigint, timeMs: number, kills: number, replayHash: Hex, sig: Hex) {
    return this.write('Finish run', 'finishRun', [runId, timeMs, kills, replayHash, sig]);
  }

  lootGrave(graveId: bigint) {
    return this.write('Loot grave', 'lootGrave', [graveId]);
  }

  private write(label: string, functionName: GameFn, args: readonly unknown[]): Promise<{ txHash: string }> {
    const status: TxStatus = { id: this.nextId++, label, state: 'queued', startedAt: Date.now() };
    this.emit(status);
    const run = async () => {
      this.emit(Object.assign(status, { state: 'signing' as const }));
      try {
        const data = encodeFunctionData({ abi: ossuaryGameAbi, functionName, args } as never);
        const sent = await this.client.submitCall({
          call: { to: game(), data },
          mode: 'developer-sponsored',
          waitForReceipt: false,
        });
        this.emit(Object.assign(status, { state: 'submitted' as const, userOpHash: sent.userOpHash }));
        // The SDK polls every 2 s by default; inclusion on Fuji takes about that long.
        const receipt = await this.client.submitter.waitForUserOperationReceipt(sent.userOpHash, {
          pollMs: 250,
          timeoutMs: 60_000,
        });
        if (!receipt) throw new Error(`UserOp ${sent.userOpHash} not mined within 60 s`);
        const res = { userOpHash: sent.userOpHash };
        const txHash = receipt.receipt.transactionHash;
        if (!receipt.success) throw new Error(`UserOp reverted (tx ${txHash})${receipt.reason ? `: ${receipt.reason}` : ''}`);
        this.emit(
          Object.assign(status, {
            state: 'confirmed' as const,
            userOpHash: res.userOpHash,
            txHash,
            ms: Date.now() - status.startedAt,
          }),
        );
        return { txHash };
      } catch (e) {
        this.emit(Object.assign(status, { state: 'failed' as const, error: errorText(e) }));
        throw e;
      }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  private emit(s: TxStatus) {
    const copy = { ...s };
    this.listeners.forEach((fn) => fn(copy));
  }
}

function game(): Address {
  if (!GAME_ADDRESS) throw new Error('NEXT_PUBLIC_GAME_ADDRESS is not set; deploy the contracts first');
  return GAME_ADDRESS;
}

function errorText(e: unknown): string {
  if (e instanceof Error) return (e as { shortMessage?: string }).shortMessage ?? e.message;
  return String(e);
}

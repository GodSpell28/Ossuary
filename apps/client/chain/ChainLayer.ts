import {
  createSmoothSendAvaxClient,
  fetchAvaxAaPublicDefaults,
  predictSimpleAccountAddress,
  type SmoothSendAvaxClient,
} from '@smoothsend/sdk/avax';
import { decodeEventLog, encodeFunctionData, type Address, type Hex, type WalletClient } from 'viem';
import { ossuaryGameAbi } from './abi';
import { GAME_ADDRESS, SMOOTHSEND_KEY, publicClient } from './config';

// Turns game actions into sponsored ERC-4337 operations. The engine never
// waits on this: it fires actions and listens for status updates.
//
// Writes go through one serial queue because every operation from a smart
// account is ordered by its EntryPoint nonce; two in flight would collide.

export type TxState = 'queued' | 'sending' | 'confirmed' | 'failed';

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
    const factory = defaults.simpleAccountFactoryFuji;
    if (!factory) throw new Error('SmoothSend did not return a Fuji account factory');
    const smartAccount = await predictSimpleAccountAddress({ publicClient, factory, owner, salt: 0n });
    const client = createSmoothSendAvaxClient({
      apiKey: SMOOTHSEND_KEY,
      network: 'testnet',
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
      this.emit(Object.assign(status, { state: 'sending' as const }));
      try {
        const data = encodeFunctionData({ abi: ossuaryGameAbi, functionName, args } as never);
        const res = await this.client.submitCall({
          call: { to: game(), data },
          mode: 'developer-sponsored',
          waitForReceipt: true,
        });
        const txHash = res.transactionHash ?? res.receipt?.receipt?.transactionHash;
        if (!txHash) throw new Error(`No transaction hash for UserOp ${res.userOpHash}`);
        if (res.receipt && res.receipt.success === false) throw new Error(`UserOp reverted (tx ${txHash})`);
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

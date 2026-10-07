import { InputLog, createSim, inputsToBase64, isOver, levelForDay, step, tileIndex, type TickInput } from '@ossuary/sim';
import { hexToString, recoverTypedDataAddress, type Address } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { VerifyError, verifyDeath, verifyFinish, type RunInfo, type VerifyDeps } from '../src/verify';

const DAY = 20733;
const player = '0x77E683b652A8909a404Fc5748f72236f3FDDB57f' as Address;
const game = '0x2e8c113ff52cc3bbb9748f64c589cf1a0a55b65f' as Address;
const signer = privateKeyToAccount(generatePrivateKey());

function deps(run: Partial<RunInfo> = {}): VerifyDeps {
  return { signer, chainId: 43113, game, readRun: async () => ({ player, day: DAY, open: true, ...run }) };
}

/** Walks through the door into the duct and stands there until the rushers win. */
function deathLog() {
  const level = levelForDay(DAY);
  const s = createSim(level, DAY);
  const log = new InputLog();
  const script: [TickInput, number][] = [
    [{ forward: 0, strafe: 1, turn: 0, buttons: 0 }, 21],
    [{ forward: 1, strafe: 0, turn: 0, buttons: 0 }, 114],
    [{ forward: 0, strafe: 0, turn: 0, buttons: 2 }, 1],
    [{ forward: 0, strafe: 0, turn: 0, buttons: 0 }, 60 * 120],
  ];
  outer: for (const [inp, n] of script) {
    for (let i = 0; i < n; i++) {
      if (isOver(s)) break outer;
      log.push(inp);
      step(s, level, inp);
    }
  }
  return { inputs: log.toArray(), tile: tileIndex(level, s.player.x >> 16, s.player.y >> 16) };
}

describe('verifyDeath', () => {
  it('signs the tile from the replay, not from the client', async () => {
    const { inputs, tile } = deathLog();
    const out = await verifyDeath(deps(), {
      runId: '2',
      player,
      inputs: inputsToBase64(inputs),
      epitaph: 'should have gone left',
      relicId: 0,
      tile: 9999,
    });
    expect(out.tile).toBe(tile);
    expect(hexToString(out.epitaph, { size: 32 })).toBe('should have gone left');
    const recovered = await recoverTypedDataAddress({
      domain: { name: 'Ossuary', version: '1', chainId: 43113, verifyingContract: game },
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
      message: { runId: 2n, player, tile, epitaph: out.epitaph, relicId: 0 },
      signature: out.signature,
    });
    expect(recovered).toBe(signer.address);
  });

  it('refuses a log that does not end in death', async () => {
    const inputs = deathLog().inputs.slice(0, 200);
    await expect(verifyDeath(deps(), { runId: '2', player, inputs: inputsToBase64(inputs) })).rejects.toThrow(
      /does not end in a death/,
    );
  });

  it('refuses someone else’s run and closed runs', async () => {
    const body = { runId: '2', player, inputs: inputsToBase64(deathLog().inputs) };
    await expect(verifyDeath(deps({ player: game }), body)).rejects.toBeInstanceOf(VerifyError);
    await expect(verifyDeath(deps({ open: false }), body)).rejects.toThrow(/closed/);
  });

  it('refuses a death replayed under another day’s seed', async () => {
    const body = { runId: '2', player, inputs: inputsToBase64(deathLog().inputs) };
    await expect(verifyDeath(deps({ day: DAY + 1 }), body)).rejects.toThrow(/does not end in a death/);
  });
});

describe('verifyFinish', () => {
  it('refuses a death log as a finish', async () => {
    const body = { runId: '2', player, inputs: inputsToBase64(deathLog().inputs) };
    await expect(verifyFinish(deps(), body)).rejects.toThrow(/does not reach the exit/);
  });
});

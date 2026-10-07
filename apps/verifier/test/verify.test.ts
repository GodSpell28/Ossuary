import { SIM_FINGERPRINT, STAND_AND_DIE, inputsToBase64, levelForDay, playScript, replay, tileIndex } from '@ossuary/sim';
import { hexToString, recoverTypedDataAddress, type Address } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { VerifyError, verifyDeath, verifyFinish, type RunInfo, type VerifyDeps } from '../src/verify';

const DAY = 20733;
const player = '0x77E683b652A8909a404Fc5748f72236f3FDDB57f' as Address;
const game = '0x2e8c113ff52cc3bbb9748f64c589cf1a0a55b65f' as Address;
const signer = privateKeyToAccount(generatePrivateKey());

function deps(run: Partial<RunInfo> = {}, relicsHeld: number[] = []): VerifyDeps {
  return {
    signer,
    chainId: 43113,
    game,
    readRun: async () => ({ player, day: DAY, open: true, ...run }),
    readRelicBalance: async (_p, id) => (relicsHeld.includes(id) ? 1n : 0n),
  };
}

/** Opens the crypt door, walks into the bone hall and stands there until killed. */
function deathLog(relic = 0) {
  const level = levelForDay(DAY);
  const { state, inputs } = playScript(level, DAY, STAND_AND_DIE, { relic });
  return { inputs, tile: tileIndex(level, state.player.x >> 16, state.player.y >> 16) };
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
      /does not reach a death/,
    );
  });

  it('refuses someone else’s run and closed runs', async () => {
    const body = { runId: '2', player, inputs: inputsToBase64(deathLog().inputs) };
    await expect(verifyDeath(deps({ player: game }), body)).rejects.toBeInstanceOf(VerifyError);
    await expect(verifyDeath(deps({ open: false }), body)).rejects.toThrow(/closed/);
  });

  it('replays under the run’s own day, so a log from another day is refused', async () => {
    const { inputs } = deathLog();
    // Two days can, by chance, kill a passive player on the same tick; use one that does not.
    const level = levelForDay(DAY);
    const other = [1, 2, 3, 4, 5].map((k) => DAY + k).find((d) => replay(level, d, inputs).outcome !== 'death')!;
    const body = { runId: '2', player, inputs: inputsToBase64(inputs) };
    await expect(verifyDeath(deps({ day: other }), body)).rejects.toThrow(/does not reach a death/);
  });
});

describe('relics', () => {
  it('refuses a relic the player does not hold', async () => {
    const body = { runId: '2', player, inputs: inputsToBase64(deathLog(6).inputs), relicId: 6 };
    await expect(verifyDeath(deps(), body)).rejects.toThrow(/does not hold relic 6/);
  });

  it('replays with the carried relic, so a relic run verifies only with that relic', async () => {
    const withPlate = deathLog(6);
    const ok = await verifyDeath(deps({}, [6]), { runId: '2', player, inputs: inputsToBase64(withPlate.inputs), relicId: 6 });
    expect(ok.tile).toBe(withPlate.tile);
    await expect(
      verifyDeath(deps({}, [6]), { runId: '2', player, inputs: inputsToBase64(withPlate.inputs), relicId: 0 }),
    ).rejects.toThrow(/does not reach a death/);
  });
});

describe('rules fingerprint', () => {
  it('tells a client running different rules to reload', async () => {
    const body = { runId: '2', player, inputs: inputsToBase64(deathLog().inputs), sim: 'deadbeef' };
    await expect(verifyDeath(deps(), body)).rejects.toThrow(/reload the page/);
  });

  it('accepts the matching fingerprint and explains a replay that does not match', async () => {
    const ok = await verifyDeath(deps(), { runId: '2', player, inputs: inputsToBase64(deathLog().inputs), sim: SIM_FINGERPRINT });
    expect(ok.tile).toBeGreaterThan(0);
    const short = deathLog().inputs.slice(0, 300);
    await expect(
      verifyDeath(deps(), { runId: '2', player, inputs: inputsToBase64(short), sim: SIM_FINGERPRINT, ticks: 300 }),
    ).rejects.toThrow(/never ended after 300 ticks \(client ran 300 ticks\)/);
  });
});

describe('verifyFinish', () => {
  it('refuses a death log as a finish', async () => {
    const body = { runId: '2', player, inputs: inputsToBase64(deathLog().inputs) };
    await expect(verifyFinish(deps(), body)).rejects.toThrow(/does not reach the exit/);
  });
});

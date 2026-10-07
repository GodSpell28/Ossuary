import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { network } from 'hardhat';
import { keccak256, stringToHex, toHex, zeroHash, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const { viem, networkHelpers } = await network.create();

// Fixed test key for the verifier; never used outside the local chain.
const verifier = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');

async function deploy() {
  const [owner, alice, bob] = await viem.getWalletClients();
  const relics = await viem.deployContract('Relics', ['ipfs://relics/{id}.json']);
  const game = await viem.deployContract('OssuaryGame', [relics.address, verifier.address]);
  await relics.write.setGame([game.address]);
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  const domain = { name: 'Ossuary', version: '1', chainId, verifyingContract: game.address } as const;

  const signDeath = (runId: bigint, player: Address, tile: number, epitaph: Hex, relicId: number) =>
    verifier.signTypedData({
      domain,
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

  const signFinish = (runId: bigint, player: Address, timeMs: number, kills: number, replayHash: Hex) =>
    verifier.signTypedData({
      domain,
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

  const today = await game.read.today();
  const as = (wallet: typeof alice) =>
    viem.getContractAt('OssuaryGame', game.address, { client: { wallet } });

  return { owner, alice, bob, relics, game, today, signDeath, signFinish, as };
}

const epitaph = stringToHex('should have gone left', { size: 32 });
const replay = keccak256(toHex('inputs'));

describe('OssuaryGame', () => {
  it('runs the full loop: finish, die carrying a relic, loot the grave', async () => {
    const { alice, bob, relics, game, today, signDeath, signFinish, as } = await networkHelpers.loadFixture(deploy);
    const a = await as(alice);
    const b = await as(bob);
    const A = alice.account.address;
    const B = bob.account.address;

    // Alice finishes a run and gets a relic.
    await a.write.startRun([today]);
    assert.equal(await game.read.openRunOf([A]), 1n);
    await a.write.finishRun([1n, 61_000, 12, replay, await signFinish(1n, A, 61_000, 12, replay)]);
    assert.equal(await game.read.bestTimeMs([today, A]), 61_000);
    const events = await game.getEvents.RunFinished();
    const relicId = Number(events[0].args.relicMinted);
    assert.ok(relicId >= 1 && relicId <= 6);
    assert.equal(await relics.read.balanceOf([A, BigInt(relicId)]), 1n);

    // She dies on her next run carrying it; the relic moves into the grave.
    await networkHelpers.time.increase(11);
    await a.write.startRun([today]);
    await a.write.recordDeath([2n, 345, epitaph, relicId, await signDeath(2n, A, 345, epitaph, relicId)]);
    assert.equal(await relics.read.balanceOf([A, BigInt(relicId)]), 0n);
    const [ids, graves] = await game.read.gravesOf([today, 0n, 10n]);
    assert.deepEqual(ids, [0n]);
    assert.equal(graves[0].tile, 345);
    assert.equal(graves[0].relicId, relicId);
    assert.equal(graves[0].epitaph, epitaph);

    // Bob, mid-run, loots it.
    await b.write.startRun([today]);
    await b.write.lootGrave([0n]);
    assert.equal(await relics.read.balanceOf([B, BigInt(relicId)]), 1n);
    assert.equal((await game.read.grave([0n])).looted, true);
    await viem.assertions.revertWithCustomError(b.write.lootGrave([0n]), game, 'AlreadyLooted');
  });

  it('rejects a tampered result', async () => {
    const { alice, game, today, signFinish, as } = await networkHelpers.loadFixture(deploy);
    const a = await as(alice);
    const A = alice.account.address;
    await a.write.startRun([today]);
    const sig = await signFinish(1n, A, 90_000, 3, replay);
    await viem.assertions.revertWithCustomError(a.write.finishRun([1n, 10_000, 3, replay, sig]), game, 'BadSignature');
    await viem.assertions.revertWithCustomError(a.write.finishRun([1n, 90_000, 3, replay, '0x1234']), game, 'BadSignature');
  });

  it('will not let one player close another player run', async () => {
    const { alice, bob, game, today, signDeath, as } = await networkHelpers.loadFixture(deploy);
    await (await as(alice)).write.startRun([today]);
    const sig = await signDeath(1n, bob.account.address, 1, epitaph, 0);
    await viem.assertions.revertWithCustomError(
      (await as(bob)).write.recordDeath([1n, 1, epitaph, 0, sig]),
      game,
      'NotYourRun',
    );
  });

  it('a signature cannot be reused on a second run', async () => {
    const { alice, game, today, signDeath, as } = await networkHelpers.loadFixture(deploy);
    const a = await as(alice);
    const A = alice.account.address;
    await a.write.startRun([today]);
    const sig = await signDeath(1n, A, 7, epitaph, 0);
    await a.write.recordDeath([1n, 7, epitaph, 0, sig]);
    await viem.assertions.revertWithCustomError(a.write.recordDeath([1n, 7, epitaph, 0, sig]), game, 'RunClosed');
    await networkHelpers.time.increase(11);
    await a.write.startRun([today]);
    await viem.assertions.revertWithCustomError(a.write.recordDeath([2n, 7, epitaph, 0, sig]), game, 'BadSignature');
  });

  it('enforces the day, the cooldown and abandons stale runs', async () => {
    const { alice, game, today, as } = await networkHelpers.loadFixture(deploy);
    const a = await as(alice);
    await viem.assertions.revertWithCustomError(a.write.startRun([today + 1]), game, 'WrongDay');
    await a.write.startRun([today]);
    await viem.assertions.revertWithCustomError(a.write.startRun([today]), game, 'Cooldown');
    await networkHelpers.time.increase(11);
    await viem.assertions.emitWithArgs(a.write.startRun([today]), game, 'RunAbandoned', [1n, alice.account.address]);
    assert.equal((await game.read.runs([1n]))[3], false);
  });

  it('guards looting', async () => {
    const { alice, bob, game, today, signDeath, as } = await networkHelpers.loadFixture(deploy);
    const a = await as(alice);
    const b = await as(bob);
    await a.write.startRun([today]);
    await a.write.recordDeath([1n, 9, zeroHash, 0, await signDeath(1n, alice.account.address, 9, zeroHash, 0)]);
    await viem.assertions.revertWithCustomError(b.write.lootGrave([0n]), game, 'NoRunToday');
    await viem.assertions.revertWithCustomError(b.write.lootGrave([5n]), game, 'NoSuchGrave');
    await networkHelpers.time.increase(11);
    await a.write.startRun([today]);
    await viem.assertions.revertWithCustomError(a.write.lootGrave([0n]), game, 'OwnGrave');
  });

  it('only the game can mint relics', async () => {
    const { alice, relics } = await networkHelpers.loadFixture(deploy);
    await viem.assertions.revertWithCustomError(
      relics.write.mint([alice.account.address, 1n], { account: alice.account }),
      relics,
      'NotGame',
    );
  });
});

// Prints what OssuaryGame and Relics currently hold on Fuji.
import { readFileSync } from 'node:fs';
import { createPublicClient, hexToString, http, parseAbi, type Hex } from 'viem';
import { avalancheFuji } from 'viem/chains';

const d = JSON.parse(readFileSync('../../packages/contracts/deployments/fuji.json', 'utf8'));
const pc = createPublicClient({ chain: avalancheFuji, transport: http() });
const abi = parseAbi([
  'function today() view returns (uint32)',
  'function nextRunId() view returns (uint256)',
  'function runs(uint256) view returns (address player, uint32 day, uint64 startedAt, bool open)',
  'function gravesOf(uint32 day, uint256 offset, uint256 limit) view returns (uint256[] ids, (address player, uint32 day, uint16 tile, uint8 relicId, bool looted, bytes32 epitaph)[] graves)',
]);
const game = d.game as Hex;
const day = await pc.readContract({ address: game, abi, functionName: 'today' });
const next = await pc.readContract({ address: game, abi, functionName: 'nextRunId' });
console.log(`day ${day}, runs so far ${next - 1n}`);
for (let i = 1n; i < next; i++) {
  const [player, rday, startedAt, open] = await pc.readContract({ address: game, abi, functionName: 'runs', args: [i] });
  console.log(`  run ${i}: ${player} day ${rday} started ${new Date(Number(startedAt) * 1000).toISOString()} ${open ? 'OPEN' : 'closed'}`);
}
const [ids, graves] = await pc.readContract({ address: game, abi, functionName: 'gravesOf', args: [day, 0n, 100n] });
console.log(`graves today: ${ids.length}`);
graves.forEach((g, i) => console.log(`  grave ${ids[i]}: tile ${g.tile} by ${g.player} relic ${g.relicId} looted ${g.looted} "${hexToString(g.epitaph, { size: 32 })}"`));

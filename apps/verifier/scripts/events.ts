// Lists every OssuaryGame and Relics event since deployment.
import { readFileSync } from 'node:fs';
import { createPublicClient, http, parseAbi, type Hex } from 'viem';
import { avalancheFuji } from 'viem/chains';

const d = JSON.parse(readFileSync('../../packages/contracts/deployments/fuji.json', 'utf8'));
const pc = createPublicClient({ chain: avalancheFuji, transport: http() });
const events = parseAbi([
  'event RunStarted(uint256 indexed runId, address indexed player, uint32 indexed day)',
  'event RunAbandoned(uint256 indexed runId, address indexed player)',
  'event GraveDug(uint256 indexed graveId, address indexed player, uint32 indexed day, uint16 tile, uint8 relicId, bytes32 epitaph)',
  'event GraveLooted(uint256 indexed graveId, address indexed looter, uint8 relicId)',
  'event RunFinished(uint256 indexed runId, address indexed player, uint32 indexed day, uint32 timeMs, uint16 kills, uint8 relicMinted)',
  'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)',
]);
const latest = await pc.getBlockNumber();
const logs = [];
for (let from = BigInt(d.deployBlock); from <= latest; from += 2048n) {
  const to = from + 2047n > latest ? latest : from + 2047n;
  logs.push(...(await pc.getLogs({ address: [d.game as Hex, d.relics as Hex], events, fromBlock: from, toBlock: to })));
}
for (const l of logs) {
  const a = Object.entries(l.args).map(([k, v]) => `${k}=${typeof v === 'string' && v.startsWith('0x') && v.length === 42 ? v.slice(0, 6) + '…' + v.slice(-4) : v}`).join(' ');
  console.log(`${l.blockNumber} ${l.eventName.padEnd(13)} ${a}  tx ${l.transactionHash}`);
}

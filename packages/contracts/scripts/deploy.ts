// Deploys Relics and OssuaryGame, links them, and writes the addresses to
// deployments/<network>.json and the client's env file.
//   pnpm exec hardhat run scripts/deploy.ts --network fuji
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { network } from 'hardhat';
import { formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const verifierKey = process.env.VERIFIER_PRIVATE_KEY as `0x${string}` | undefined;
if (!verifierKey) throw new Error('VERIFIER_PRIVATE_KEY missing from .env');
const verifier = privateKeyToAccount(verifierKey).address;

const conn = await network.create();
const { viem } = conn;
const publicClient = await viem.getPublicClient();
const [deployer] = await viem.getWalletClients();
const chainId = await publicClient.getChainId();
const balance = await publicClient.getBalance({ address: deployer.account.address });
console.log(`network ${conn.networkName} (chain ${chainId})`);
console.log(`deployer ${deployer.account.address}, balance ${formatEther(balance)} AVAX`);
if (balance === 0n) throw new Error('Deployer has no AVAX. Fund it from the Fuji faucet first.');

const relics = await viem.deployContract('Relics', ['https://ossuary.example/relics/{id}.json']);
console.log(`Relics       ${relics.address}`);
const game = await viem.deployContract('OssuaryGame', [relics.address, verifier]);
console.log(`OssuaryGame  ${game.address}`);
const tx = await relics.write.setGame([game.address]);
await publicClient.waitForTransactionReceipt({ hash: tx });
console.log(`linked (tx ${tx})`);

const block = await publicClient.getBlockNumber();
const out = { chainId, relics: relics.address, game: game.address, verifier, deployBlock: Number(block) };
mkdirSync('deployments', { recursive: true });
writeFileSync(`deployments/${conn.networkName}.json`, JSON.stringify(out, null, 2) + '\n');

// Point the client at the new contracts.
const envPath = '../../apps/client/.env.local';
if (existsSync(envPath)) {
  let env = readFileSync(envPath, 'utf8');
  const set = (k: string, v: string) => {
    env = env.match(new RegExp(`^${k}=`, 'm')) ? env.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`) : env + `${k}=${v}\n`;
  };
  set('NEXT_PUBLIC_GAME_ADDRESS', game.address);
  set('NEXT_PUBLIC_RELICS_ADDRESS', relics.address);
  set('NEXT_PUBLIC_DEPLOY_BLOCK', String(block));
  writeFileSync(envPath, env);
  console.log('updated apps/client/.env.local');
}

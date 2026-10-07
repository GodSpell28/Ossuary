import { network } from 'hardhat';
import { formatEther } from 'viem';

const { viem } = await network.create();
const [deployer] = await viem.getWalletClients();
const pc = await viem.getPublicClient();
console.log(deployer.account.address, formatEther(await pc.getBalance({ address: deployer.account.address })), 'AVAX');

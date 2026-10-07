import 'dotenv/config';
import hardhatToolboxViem from '@nomicfoundation/hardhat-toolbox-viem';
import { defineConfig } from 'hardhat/config';

const deployer = process.env.DEPLOYER_PRIVATE_KEY;

export default defineConfig({
  plugins: [hardhatToolboxViem],
  solidity: {
    version: '0.8.28',
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun' },
  },
  networks: {
    fuji: {
      type: 'http',
      chainType: 'l1',
      chainId: 43113,
      url: process.env.FUJI_RPC_URL ?? 'https://api.avax-test.network/ext/bc/C/rpc',
      accounts: deployer ? [deployer] : [],
    },
  },
});

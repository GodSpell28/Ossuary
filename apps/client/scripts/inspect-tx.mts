// Decodes a sponsored Ossuary transaction: who sent it, what it called, and
// which ERC-4337 and game events it emitted.
//   node scripts/inspect-tx.mts <txHash>
import { createPublicClient, decodeEventLog, decodeFunctionData, formatEther, http, parseAbi } from 'viem';
import { avalancheFuji } from 'viem/chains';
import { ossuaryGameAbi } from '../chain/abi.ts';

const hash = process.argv[2] as `0x${string}`;
const c = createPublicClient({ chain: avalancheFuji, transport: http() });
const [tx, rc] = await Promise.all([c.getTransaction({ hash }), c.getTransactionReceipt({ hash })]);

const entryPointAbi = parseAbi([
  'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)',
  'event AccountDeployed(bytes32 indexed userOpHash, address indexed sender, address factory, address paymaster)',
  'event BeforeExecution()',
  'function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops, address beneficiary)',
]);
const accountAbi = parseAbi(['function execute(address dest, uint256 value, bytes func)']);

console.log('block      ', rc.blockNumber, rc.status);
console.log('from (EOA) ', tx.from, '<- pays the AVAX gas');
console.log('to         ', tx.to);
console.log('gas used   ', rc.gasUsed, '×', rc.effectiveGasPrice, '=', formatEther(rc.gasUsed * rc.effectiveGasPrice), 'AVAX');

const outer = decodeFunctionData({ abi: entryPointAbi, data: tx.input });
console.log('\ncalled     ', outer.functionName, 'with', (outer.args[0] as unknown[]).length, 'UserOperation(s), beneficiary', outer.args[1]);
for (const op of outer.args[0] as any[]) {
  console.log('  sender (smart account)', op.sender, 'nonce', op.nonce);
  console.log('  initCode              ', op.initCode === '0x' ? '(none, account already exists)' : op.initCode.slice(0, 42) + '… (deploys the account)');
  console.log('  paymaster             ', op.paymasterAndData.slice(0, 42));
  console.log('  signature             ', op.signature.slice(0, 20) + '… (' + (op.signature.length - 2) / 2 + ' bytes, by the owner key)');
  const exec = decodeFunctionData({ abi: accountAbi, data: op.callData });
  const [dest, value, func] = exec.args as [string, bigint, `0x${string}`];
  const inner = decodeFunctionData({ abi: ossuaryGameAbi, data: func });
  console.log('  callData              ', `account.execute(${dest}, ${value}, …)`, '->', `${inner.functionName}(${inner.args?.join(', ')})`);
}

console.log('\nevents:');
for (const log of rc.logs) {
  for (const abi of [entryPointAbi, ossuaryGameAbi] as const) {
    try {
      const ev = decodeEventLog({ abi, ...log } as any) as any;
      const args = Object.entries(ev.args ?? {}).map(([k, v]) => `${k}=${typeof v === 'bigint' && k === 'actualGasCost' ? formatEther(v) + ' AVAX' : v}`);
      console.log(' ', log.address.slice(0, 10) + '…', ev.eventName, args.join(' '));
      break;
    } catch {}
  }
}

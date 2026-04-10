import { MemoryAccount } from '@aeternity/aepp-sdk';

const account = MemoryAccount.generate();

console.log('=== New Aeternity Wallet ===');
console.log(`Address:    ${account.address}`);
console.log(`Secret Key: ${account.secretKey}`);

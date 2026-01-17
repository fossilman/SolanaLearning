// create-ata.ts
import {
    getOrCreateAssociatedTokenAccount,
    getAssociatedTokenAddress
} from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import { connection, loadWallet } from './config';

async function getOrCreateATA(mintAddress: string) {
    const payer = loadWallet();
    const mint = new PublicKey(mintAddress);

    // 方法一：只计算 ATA 地址（不创建）
    const ataAddress = await getAssociatedTokenAddress(
        mint,
        payer.publicKey
    );
    console.log('计算得出的 ATA 地址:', ataAddress.toBase58());

    // 方法二：获取或创建 ATA（如果不存在则创建）
    const tokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,              // 支付方
        mint,               // 代币 Mint
        payer.publicKey     // ATA 所有者
    );

    console.log('Token Account 地址:', tokenAccount.address.toBase58());
    console.log('当前余额:', tokenAccount.amount.toString());

    return tokenAccount;
}

// 使用方式：npx ts-node create-ata.ts <MINT_ADDRESS>
const mintAddress = process.argv[2];
if (!mintAddress) {
    console.error('请提供 Mint 地址作为参数');
    process.exit(1);
}

getOrCreateATA(mintAddress);
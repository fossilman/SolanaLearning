// transfer.ts
import {
    transfer,
    getOrCreateAssociatedTokenAccount,
    getMint
} from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import { connection, loadWallet } from './config';

async function transferTokens(
    mintAddress: string,
    recipientWallet: string,
    amount: number
) {
    const payer = loadWallet();
    const mint = new PublicKey(mintAddress);
    const recipient = new PublicKey(recipientWallet);

    // 获取精度
    const mintInfo = await getMint(connection, mint);
    const rawAmount = BigInt(amount * (10 ** mintInfo.decimals));

    // 获取发送方的 Token Account
    const sourceAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        mint,
        payer.publicKey
    );

    // 获取或创建接收方的 Token Account
    // 注意：这里创建账户的费用由 payer 支付
    const destinationAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        mint,
        recipient  // 接收方的钱包地址（不是 Token Account）
    );

    console.log('发送方 Token Account:', sourceAccount.address.toBase58());
    console.log('接收方 Token Account:', destinationAccount.address.toBase58());
    console.log('转账数量:', amount);

    // 执行转账
    const signature = await transfer(
        connection,
        payer,                      // 支付方 & 签名者
        sourceAccount.address,      // 发送方 Token Account
        destinationAccount.address, // 接收方 Token Account
        payer,                      // 发送方所有者（签名）
        rawAmount
    );

    console.log('转账成功！');
    console.log('交易签名:', signature);
}

// 使用方式：npx ts-node transfer.ts <MINT> <RECIPIENT_WALLET> <AMOUNT>
transferTokens(process.argv[2], process.argv[3], Number(process.argv[4]));
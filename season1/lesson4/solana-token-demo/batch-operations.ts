// batch-operations.ts
import {
    createMint,
    getOrCreateAssociatedTokenAccount,
    createMintToInstruction,
    createTransferInstruction,
    getMint
} from '@solana/spl-token';
import {
    Transaction,
    sendAndConfirmTransaction,
    Keypair,
    PublicKey
} from '@solana/web3.js';
import { connection, loadWallet } from './config';

async function batchMintAndTransfer() {
    const payer = loadWallet();

    // 第一步：创建代币
    console.log('1. 创建新代币...');
    const mint = await createMint(
        connection,
        payer,
        payer.publicKey,
        null,  // 不设置冻结权限
        6
    );
    console.log('Mint 地址:', mint.toBase58());

    // 第二步：创建发送方和接收方的 Token Account
    console.log('2. 创建 Token Accounts...');
    const senderATA = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        mint,
        payer.publicKey
    );

    // 创建一个临时接收方
    const recipient = Keypair.generate();
    const recipientATA = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        mint,
        recipient.publicKey
    );

    // 第三步：构建批量交易（铸造 + 转账）
    console.log('3. 构建批量交易...');
    const transaction = new Transaction();

    // 添加铸造指令：铸造 1000 个代币
    transaction.add(
        createMintToInstruction(
            mint,
            senderATA.address,
            payer.publicKey,  // Mint Authority
            1000_000_000n     // 1000 * 10^6
        )
    );

    // 添加转账指令：转 200 个给接收方
    transaction.add(
        createTransferInstruction(
            senderATA.address,
            recipientATA.address,
            payer.publicKey,
            200_000_000n      // 200 * 10^6
        )
    );

    // 发送交易
    console.log('4. 发送交易...');
    const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [payer]
    );

    console.log('交易成功！');
    console.log('签名:', signature);
    console.log('发送方余额: 800');
    console.log('接收方余额: 200');
}

batchMintAndTransfer();
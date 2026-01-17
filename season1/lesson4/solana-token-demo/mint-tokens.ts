// mint-tokens.ts
import { mintTo, getMint, getAccount } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import { connection, loadWallet, formatTokenAmount } from './config';

async function mintTokens(
    mintAddress: string,
    destinationAddress: string,
    amount: number
) {
    const payer = loadWallet();
    const mint = new PublicKey(mintAddress);
    const destination = new PublicKey(destinationAddress);

    // 获取 Mint 信息以确定精度
    const mintInfo = await getMint(connection, mint);

    // 将用户输入的数量转换为底层数值
    const rawAmount = BigInt(amount * (10 ** mintInfo.decimals));

    console.log('铸造代币...');
    console.log('数量:', amount);
    console.log('底层数值:', rawAmount.toString());

    // 执行铸造
    const signature = await mintTo(
        connection,
        payer,              // 支付方
        mint,               // Mint 地址
        destination,        // 接收账户（Token Account，不是钱包地址）
        payer,              // Mint Authority
        rawAmount           // 数量（底层数值）
    );

    console.log('铸造成功！');
    console.log('交易签名:', signature);

    // 查询更新后的信息
    const updatedMint = await getMint(connection, mint);
    const destinationAccount = await getAccount(connection, destination);

    console.log('当前总供应量:', formatTokenAmount(updatedMint.supply, mintInfo.decimals));
    console.log('接收账户余额:', formatTokenAmount(destinationAccount.amount, mintInfo.decimals));
}

// 使用方式：npx ts-node mint-tokens.ts <MINT> <TOKEN_ACCOUNT> <AMOUNT>
mintTokens(process.argv[2], process.argv[3], Number(process.argv[4]));
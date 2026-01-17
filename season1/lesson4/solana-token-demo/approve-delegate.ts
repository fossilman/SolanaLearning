// approve-delegate.ts
import {
    approve,
    revoke,
    getAccount,
    getOrCreateAssociatedTokenAccount,
    getMint
} from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import { connection, loadWallet } from './config';

async function approveDelegate(
    mintAddress: string,
    delegateAddress: string,
    amount: number
) {
    const payer = loadWallet();
    const mint = new PublicKey(mintAddress);
    const delegate = new PublicKey(delegateAddress);

    const mintInfo = await getMint(connection, mint);
    const rawAmount = BigInt(amount * (10 ** mintInfo.decimals));

    // 获取 Token Account
    const tokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        mint,
        payer.publicKey
    );

    // 授权给委托人
    const signature = await approve(
        connection,
        payer,
        tokenAccount.address,  // 被授权的 Token Account
        delegate,              // 委托人地址
        payer,                 // Token Account 所有者
        rawAmount              // 授权额度
    );

    console.log('授权成功！');
    console.log('委托人:', delegateAddress);
    console.log('授权额度:', amount);
    console.log('交易签名:', signature);

    // 验证授权状态
    const accountInfo = await getAccount(connection, tokenAccount.address);
    console.log('当前委托人:', accountInfo.delegate?.toBase58() || '无');
    console.log('委托额度:', accountInfo.delegatedAmount.toString());
}

async function revokeDelegate(mintAddress: string) {
    const payer = loadWallet();
    const mint = new PublicKey(mintAddress);

    const tokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        mint,
        payer.publicKey
    );

    // 撤销授权
    const signature = await revoke(
        connection,
        payer,
        tokenAccount.address,
        payer
    );

    console.log('已撤销授权');
    console.log('交易签名:', signature);
}
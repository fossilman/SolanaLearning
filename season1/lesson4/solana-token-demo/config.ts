// config.ts
import { Connection, Keypair, clusterApiUrl } from '@solana/web3.js';
import fs from 'fs';

// 连接到 Devnet
export const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

// 从文件加载钱包（与 CLI 使用相同的密钥）
export function loadWallet(): Keypair {
    const secretKey = JSON.parse(
        fs.readFileSync(`${process.env.HOME}/.config/solana/id.json`, 'utf-8')
    );
    return Keypair.fromSecretKey(new Uint8Array(secretKey));
}

// 辅助函数：格式化代币数量
export function formatTokenAmount(amount: bigint, decimals: number): string {
    const divisor = BigInt(10 ** decimals);
    const integerPart = amount / divisor;
    const fractionalPart = amount % divisor;

    if (fractionalPart === 0n) {
        return integerPart.toString();
    }

    const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
    return `${integerPart}.${fractionalStr.replace(/0+$/, '')}`;
}
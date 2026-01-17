// config.ts
import { Connection, Keypair } from '@solana/web3.js';
import fs from 'fs';
import { getNetworkConfig, getCurrentNetwork, type Network } from './networks';

// 获取当前网络配置
const networkConfig = getNetworkConfig();
const currentNetwork = getCurrentNetwork();

// 连接到配置的网络
export const connection = new Connection(
    networkConfig.rpcUrl,
    networkConfig.commitment
);

// 导出当前网络信息
export { currentNetwork, networkConfig };
export type { Network };

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
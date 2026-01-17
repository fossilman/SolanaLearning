// networks.ts
// 网络配置管理 - 从配置文件加载

import fs from 'fs';
import path from 'path';

export type Network = string;
export type Commitment = 'processed' | 'confirmed' | 'finalized';

export interface NetworkConfig {
    name: string;
    rpcUrl: string;
    commitment: Commitment;
}

export interface SolanaConfig {
    defaultNetwork: string;
    networks: Record<string, NetworkConfig>;
}

// 配置文件路径
const CONFIG_FILE = path.resolve(process.cwd(), 'solana.config.json');

// 加载配置文件
function loadConfig(): SolanaConfig {
    try {
        const configContent = fs.readFileSync(CONFIG_FILE, 'utf-8');
        const config: SolanaConfig = JSON.parse(configContent);
        
        // 验证配置格式
        if (!config.networks || typeof config.networks !== 'object') {
            throw new Error('配置文件格式错误: networks 字段缺失或格式不正确');
        }
        
        if (!config.defaultNetwork) {
            throw new Error('配置文件格式错误: defaultNetwork 字段缺失');
        }
        
        return config;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new Error(`配置文件不存在: ${CONFIG_FILE}\n请创建配置文件或使用默认配置`);
        }
        throw new Error(`加载配置文件失败: ${error}`);
    }
}

// 获取所有网络配置
export function getNetworks(): Record<string, NetworkConfig> {
    const config = loadConfig();
    return config.networks;
}

// 获取当前网络（优先级：环境变量 > 配置文件默认值）
export function getCurrentNetwork(): Network {
    // 优先使用环境变量
    const envNetwork = process.env.SOLANA_NETWORK?.toLowerCase();
    if (envNetwork) {
        const config = loadConfig();
        if (config.networks[envNetwork]) {
            return envNetwork;
        }
        console.warn(`警告: 环境变量 SOLANA_NETWORK=${envNetwork} 在配置文件中不存在，使用默认网络`);
    }
    
    // 使用配置文件中的默认值
    const config = loadConfig();
    return config.defaultNetwork;
}

// 获取网络配置
export function getNetworkConfig(network?: Network): NetworkConfig {
    const config = loadConfig();
    const targetNetwork = network || getCurrentNetwork();
    
    const networkConfig = config.networks[targetNetwork];
    if (!networkConfig) {
        throw new Error(`网络 "${targetNetwork}" 在配置文件中不存在`);
    }
    
    return networkConfig;
}

// 验证网络是否存在
export function networkExists(network: Network): boolean {
    try {
        const config = loadConfig();
        return network in config.networks;
    } catch {
        return false;
    }
}

// 获取所有可用的网络名称
export function getAvailableNetworks(): string[] {
    const config = loadConfig();
    return Object.keys(config.networks);
}

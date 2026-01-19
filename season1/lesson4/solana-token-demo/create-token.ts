// create-token.ts
import {
    getMinimumBalanceForRentExemptMint,
    createInitializeMint2Instruction,
    TOKEN_PROGRAM_ID,
    MINT_SIZE
} from '@solana/spl-token';
import {
    Transaction,
    SystemProgram,
    Keypair,
    PublicKey
} from '@solana/web3.js';
import { connection, loadWallet, currentNetwork, networkConfig } from './config';

/**
 * 使用代理轮询确认交易状态，不设置超时限制
 */
async function confirmTransactionWithProxy(
    signature: string,
    maxRetries: number = Infinity
): Promise<void> {
    let retries = 0;
    const checkInterval = 2000; // 每2秒检查一次

    while (retries < maxRetries) {
        try {
            const status = await connection.getSignatureStatus(signature);
            
            if (status?.value) {
                if (status.value.err) {
                    throw new Error(`交易失败: ${JSON.stringify(status.value.err)}`);
                }
                
                const confirmationStatus = status.value.confirmationStatus;
                if (confirmationStatus === 'confirmed' || confirmationStatus === 'finalized') {
                    console.log(`✅ 交易已确认，状态: ${confirmationStatus}`);
                    return;
                }
            }
            
            // 如果交易还未确认，继续等待
            if (retries % 10 === 0) {
                console.log(`⏳ 等待交易确认... (已等待 ${retries * checkInterval / 1000} 秒)`);
            }
            
            await new Promise(resolve => setTimeout(resolve, checkInterval));
            retries++;
        } catch (err: any) {
            // 如果是交易失败错误，直接抛出
            if (err.message?.includes('交易失败')) {
                throw err;
            }
            // 其他错误（如网络错误），继续重试
            console.warn(`⚠️  检查交易状态时出错，继续重试... (${err.message})`);
            await new Promise(resolve => setTimeout(resolve, checkInterval));
            retries++;
        }
    }
    
    throw new Error('交易确认超时');
}

async function createToken() {
    const payer = loadWallet();

    console.log('创建新代币...');
    console.log('当前网络:', networkConfig.name, `(${currentNetwork})`);
    console.log('RPC URL:', networkConfig.rpcUrl);
    console.log('钱包地址:', payer.publicKey.toBase58());

    try {
        // 生成新的 Mint 账户密钥对
        const mint = Keypair.generate();
        console.log('Mint 地址:', mint.publicKey.toBase58());

        // 获取创建 Mint 账户所需的最小租金
        const mintRent = await getMinimumBalanceForRentExemptMint(connection);
        console.log('Mint 账户租金:', mintRent, 'lamports');

        // 构建交易
        const transaction = new Transaction();

        // 1. 创建 Mint 账户
        const createAccountIx = SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: mint.publicKey,
            space: MINT_SIZE,
            lamports: mintRent,
            programId: TOKEN_PROGRAM_ID,
        });

        // 2. 初始化 Mint 账户
        const initializeMintIx = createInitializeMint2Instruction(
            mint.publicKey,
            6, // 小数位数
            payer.publicKey, // Mint Authority（铸币权限）
            payer.publicKey  // Freeze Authority（冻结权限）
        );

        transaction.add(createAccountIx, initializeMintIx);

        // 获取最新的区块哈希
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = payer.publicKey;

        // 签名交易
        transaction.sign(payer, mint);

        // 发送交易
        console.log('发送交易...');
        const signature = await connection.sendTransaction(transaction, [payer, mint], {
            skipPreflight: false,
            maxRetries: 3,
        });

        console.log('交易已发送，签名:', signature);
        console.log(`查看交易: https://explorer.solana.com/tx/${signature}?cluster=${currentNetwork}`);

        // 使用代理轮询确认交易状态，不设置超时限制
        console.log('等待交易确认（使用代理，无超时限制）...');
        await confirmTransactionWithProxy(signature);

        console.log('代币创建成功！');
        console.log('Mint 地址:', mint.publicKey.toBase58());

        return mint.publicKey;
    } catch (err: any) {
        console.error('❌ 创建代币失败:', err);
        throw err;
    }
}

createToken()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('错误:', err);
        process.exit(1);
    });
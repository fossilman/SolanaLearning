// create-token.ts
import { createMint } from '@solana/spl-token';
import { connection, loadWallet } from './config';

async function createToken() {
    const payer = loadWallet();

    console.log('创建新代币...');
    console.log('钱包地址:', payer.publicKey.toBase58());

    // 创建 Mint 账户
    const mint = await createMint(
        connection,           // 连接
        payer,               // 支付交易费用和租金的账户
        payer.publicKey,     // Mint Authority（铸币权限）
        payer.publicKey,     // Freeze Authority（冻结权限），可设为 null
        6                    // 小数位数
    );

    console.log('代币创建成功！');
    console.log('Mint 地址:', mint.toBase58());

    return mint;
}

createToken()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('错误:', err);
        process.exit(1);
    });
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TokenPart3 } from "../target/types/token_part3";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getMint,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, SystemProgram, Connection, PublicKey } from "@solana/web3.js";

// 辅助函数：打印账户详细信息
async function printAccountInfo(
  connection: Connection,
  address: PublicKey,
  accountType: string,
  tokenProgramId?: PublicKey
) {
  console.log(`\n   [账户类型: ${accountType}]`);
  console.log(`   - 地址: ${address.toString()}`);
  
  try {
    const accountInfo = await connection.getAccountInfo(address);
    if (accountInfo) {
      console.log(`   - 所有者程序: ${accountInfo.owner.toString()}`);
      console.log(`   - 数据长度: ${accountInfo.data.length} 字节`);
      console.log(`   - 是否可执行: ${accountInfo.executable ? "是" : "否"}`);
      console.log(`   - 租金豁免: ${accountInfo.lamports} lamports`);
      
      // 如果是 Mint 账户
      if (accountType.includes("Mint")) {
        try {
          const mintInfo = await getMint(connection, address, undefined, tokenProgramId);
          console.log(`   - 代币精度: ${mintInfo.decimals}`);
          console.log(`   - 总供应量: ${mintInfo.supply.toString()}`);
          console.log(`   - Mint 权限: ${mintInfo.mintAuthority?.toString() || "无（已撤销）"}`);
          console.log(`   - 冻结权限: ${mintInfo.freezeAuthority?.toString() || "无"}`);
        } catch (e) {
          console.log(`   - Mint 信息获取失败: ${e}`);
        }
      }
      
      // 如果是 Token 账户
      if (accountType.includes("Token账户")) {
        try {
          const tokenAccountInfo = await getAccount(connection, address, undefined, tokenProgramId);
          console.log(`   - Mint 地址: ${tokenAccountInfo.mint.toString()}`);
          console.log(`   - 所有者: ${tokenAccountInfo.owner.toString()}`);
          console.log(`   - 余额: ${tokenAccountInfo.amount.toString()}`);
          console.log(`   - 状态: ${tokenAccountInfo.state === 1 ? "已初始化" : tokenAccountInfo.state === 2 ? "已冻结" : "未知"}`);
          console.log(`   - 是否可委托: ${tokenAccountInfo.delegate ? tokenAccountInfo.delegate.toString() : "无"}`);
          console.log(`   - 是否关闭: ${tokenAccountInfo.closeAuthority ? tokenAccountInfo.closeAuthority.toString() : "无"}`);
        } catch (e) {
          console.log(`   - Token 账户信息获取失败: ${e}`);
        }
      }
      
      // 如果是元数据账户
      if (accountType.includes("元数据")) {
        console.log(`   - 元数据账户由 Metaplex 程序管理`);
        if (accountInfo.data.length > 0) {
          console.log(`   - 元数据已初始化`);
        } else {
          console.log(`   - 元数据未初始化`);
        }
      }
      
      // 如果是系统账户
      if (accountInfo.owner.equals(SystemProgram.programId)) {
        const balance = await connection.getBalance(address);
        console.log(`   - SOL 余额: ${balance / LAMPORTS_PER_SOL} SOL (${balance} lamports)`);
      }
    } else {
      console.log(`   - 状态: 账户不存在`);
    }
  } catch (e) {
    console.log(`   - 获取账户信息失败: ${e}`);
  }
  console.log("");
}

describe("token_part3", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.tokenPart3 as Program<TokenPart3>;

  it("PART3: 演示带 Metaplex 元数据的代币生命周期", async () => {
    console.log("\n========== PART3: 带 Metaplex 元数据的代币生命周期演示开始 ==========\n");

    // 获取提供者信息
    const payer = provider.wallet as anchor.Wallet;
    const connection = provider.connection;

    // Metaplex Token Metadata 程序 ID
    const METADATA_PROGRAM_ID = new anchor.web3.PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

    console.log("1. 初始化信息");
    console.log("   - 支付账户:", payer.publicKey.toString());
    console.log("   - 程序 ID:", program.programId.toString());
    console.log("   - Token 程序 ID:", TOKEN_PROGRAM_ID.toString());
    console.log("   - Metadata 程序 ID:", METADATA_PROGRAM_ID.toString());
    console.log("");

    // 创建代币 Mint
    console.log("2. 创建代币 Mint（将添加 Metaplex 元数据）");
    const mintKeypair = Keypair.generate();
    const mint = mintKeypair.publicKey;
    console.log("   - Mint 地址:", mint.toString());
    console.log("   - 使用 TOKEN_PROGRAM_ID + METADATA_PROGRAM_ID 创建代币");

    // 计算元数据账户地址
    const [metadataAccount] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        METADATA_PROGRAM_ID.toBuffer(),
        mint.toBuffer(),
      ],
      METADATA_PROGRAM_ID
    );
    console.log("   - 元数据账户地址:", metadataAccount.toString());
    
    // 打印创建前的账户状态
    console.log("\n   [创建前账户状态]");
    await printAccountInfo(connection, mint, "Mint账户（创建前）", TOKEN_PROGRAM_ID);
    await printAccountInfo(connection, metadataAccount, "元数据账户（创建前）");

    const createTokenTx = await program.methods
      .createToken()
      .accounts({
        authority: payer.publicKey,
        mint: mint,
        metadataAccount: metadataAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKeypair])
      .rpc();

    console.log("   - 交易签名:", createTokenTx);
    
    // 打印创建后的账户状态
    console.log("   [创建后账户状态]");
    await printAccountInfo(connection, mint, "Mint账户（创建后）", TOKEN_PROGRAM_ID);
    await printAccountInfo(connection, metadataAccount, "元数据账户（创建后）");
    await printAccountInfo(connection, payer.publicKey, "支付账户（Authority）");
    
    console.log("   ✓ 代币创建成功（元数据账户已预留）\n");

    // 创建代币账户（发送方）
    console.log("3. 创建发送方的代币账户");
    const senderTokenAccount = await getAssociatedTokenAddress(
      mint,
      payer.publicKey
    );
    console.log("   - 发送方代币账户:", senderTokenAccount.toString());
    
    // 打印创建前的账户状态
    console.log("\n   [创建前账户状态]");
    await printAccountInfo(connection, senderTokenAccount, "Token账户（发送方，创建前）", TOKEN_PROGRAM_ID);

    const createSenderAccountIx = createAssociatedTokenAccountInstruction(
      payer.publicKey,
      senderTokenAccount,
      payer.publicKey,
      mint
    );

    const createSenderTx = await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(createSenderAccountIx)
    );
    console.log("   - 交易签名:", createSenderTx);
    
    // 打印创建后的账户状态
    console.log("   [创建后账户状态]");
    await printAccountInfo(connection, senderTokenAccount, "Token账户（发送方，创建后）", TOKEN_PROGRAM_ID);
    
    console.log("   ✓ 发送方代币账户创建成功\n");

    // 创建接收方账户和代币账户
    console.log("4. 创建接收方账户");
    const receiver = Keypair.generate();
    console.log("   - 接收方地址:", receiver.publicKey.toString());

    // 给接收方一些 SOL 用于支付交易费用
    const airdropSignature = await connection.requestAirdrop(
      receiver.publicKey,
      1 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropSignature);
    console.log("   - 已为接收方空投 SOL\n");

    console.log("5. 创建接收方的代币账户");
    const receiverTokenAccount = await getAssociatedTokenAddress(
      mint,
      receiver.publicKey
    );
    console.log("   - 接收方代币账户:", receiverTokenAccount.toString());
    
    // 打印创建前的账户状态
    console.log("\n   [创建前账户状态]");
    await printAccountInfo(connection, receiverTokenAccount, "Token账户（接收方，创建前）", TOKEN_PROGRAM_ID);

    const createReceiverAccountIx = createAssociatedTokenAccountInstruction(
      payer.publicKey,
      receiverTokenAccount,
      receiver.publicKey,
      mint
    );

    const createReceiverTx = await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(createReceiverAccountIx)
    );
    console.log("   - 交易签名:", createReceiverTx);
    
    // 打印创建后的账户状态
    console.log("   [创建后账户状态]");
    await printAccountInfo(connection, receiverTokenAccount, "Token账户（接收方，创建后）", TOKEN_PROGRAM_ID);
    
    console.log("   ✓ 接收方代币账户创建成功\n");

    // 铸造代币
    console.log("6. 铸造带元数据的代币到发送方账户");
    const mintAmount = 1000 * 10 ** 9; // 1000 个代币（考虑 9 位小数）
    console.log("   - 铸造数量: 1000 代币");
    
    // 打印铸造前的账户状态
    console.log("\n   [铸造前账户状态]");
    await printAccountInfo(connection, mint, "Mint账户（铸造前）", TOKEN_PROGRAM_ID);
    await printAccountInfo(connection, senderTokenAccount, "Token账户（发送方，铸造前）", TOKEN_PROGRAM_ID);

    const mintTokensTx = await program.methods
      .mintTokens(new anchor.BN(mintAmount))
      .accounts({
        authority: payer.publicKey,
        mint: mint,
        tokenAccount: senderTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("   - 交易签名:", mintTokensTx);
    
    // 打印铸造后的账户状态
    console.log("   [铸造后账户状态]");
    await printAccountInfo(connection, mint, "Mint账户（铸造后）", TOKEN_PROGRAM_ID);
    await printAccountInfo(connection, senderTokenAccount, "Token账户（发送方，铸造后）", TOKEN_PROGRAM_ID);
    
    console.log("   ✓ 带元数据的代币铸造成功\n");

    // 转账代币
    console.log("7. 从发送方转账带元数据的代币到接收方");
    const transferAmount = 200 * 10 ** 9; // 200 个代币
    console.log("   - 转账数量: 200 代币");
    
    // 打印转账前的账户状态
    console.log("\n   [转账前账户状态]");
    await printAccountInfo(connection, senderTokenAccount, "Token账户（发送方，转账前）", TOKEN_PROGRAM_ID);
    await printAccountInfo(connection, receiverTokenAccount, "Token账户（接收方，转账前）", TOKEN_PROGRAM_ID);

    const transferTx = await program.methods
      .transferTokens(new anchor.BN(transferAmount))
      .accounts({
        authority: payer.publicKey,
        from: senderTokenAccount,
        to: receiverTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("   - 交易签名:", transferTx);
    
    // 打印转账后的账户状态
    console.log("   [转账后账户状态]");
    await printAccountInfo(connection, senderTokenAccount, "Token账户（发送方，转账后）", TOKEN_PROGRAM_ID);
    await printAccountInfo(connection, receiverTokenAccount, "Token账户（接收方，转账后）", TOKEN_PROGRAM_ID);

    console.log("   ✓ 带元数据的代币转账成功\n");

    // 销毁代币
    console.log("8. 销毁发送方账户中的带元数据的代币");
    const burnAmount = 100 * 10 ** 9; // 100 个代币
    console.log("   - 销毁数量: 100 代币");
    
    // 打印销毁前的账户状态
    console.log("\n   [销毁前账户状态]");
    await printAccountInfo(connection, mint, "Mint账户（销毁前）", TOKEN_PROGRAM_ID);
    await printAccountInfo(connection, senderTokenAccount, "Token账户（发送方，销毁前）", TOKEN_PROGRAM_ID);

    const burnTx = await program.methods
      .burnTokens(new anchor.BN(burnAmount))
      .accounts({
        authority: payer.publicKey,
        mint: mint,
        tokenAccount: senderTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("   - 交易签名:", burnTx);
    
    // 打印销毁后的账户状态
    console.log("   [销毁后账户状态]");
    await printAccountInfo(connection, mint, "Mint账户（销毁后）", TOKEN_PROGRAM_ID);
    await printAccountInfo(connection, senderTokenAccount, "Token账户（发送方，销毁后）", TOKEN_PROGRAM_ID);

    console.log("   ✓ 带元数据的代币销毁成功\n");

    // 关闭代币账户
    console.log("9. 关闭接收方的代币账户");
    console.log("   - 注意: 关闭账户会将账户中的剩余代币销毁，并将租金返还给接收方");
    
    // 打印关闭前的账户状态
    console.log("\n   [关闭前账户状态]");
    await printAccountInfo(connection, receiverTokenAccount, "Token账户（接收方，关闭前）", TOKEN_PROGRAM_ID);
    await printAccountInfo(connection, receiver.publicKey, "接收方系统账户（关闭前）");
    await printAccountInfo(connection, mint, "Mint账户（关闭前）", TOKEN_PROGRAM_ID);

    const closeTx = await program.methods
      .closeTokenAccount()
      .accounts({
        authority: receiver.publicKey,
        tokenAccount: receiverTokenAccount,
        destination: receiver.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([receiver])
      .rpc();

    console.log("   - 交易签名:", closeTx);
    
    // 打印关闭后的账户状态
    console.log("   [关闭后账户状态]");
    await printAccountInfo(connection, receiverTokenAccount, "Token账户（接收方，关闭后）", TOKEN_PROGRAM_ID);
    await printAccountInfo(connection, receiver.publicKey, "接收方系统账户（关闭后）");
    await printAccountInfo(connection, mint, "Mint账户（关闭后）", TOKEN_PROGRAM_ID);
    
    console.log("   ✓ 代币账户关闭成功\n");

    // 总结
    console.log("========== PART3: 带 Metaplex 元数据的代币生命周期演示完成 ==========");
    console.log("\n总结:");
    console.log("  1. ✓ 创建代币 Mint（使用 TOKEN_PROGRAM_ID + METADATA_PROGRAM_ID）");
    console.log("  2. ✓ 创建代币账户");
    console.log("  3. ✓ 铸造代币");
    console.log("  4. ✓ 转账代币");
    console.log("  5. ✓ 销毁代币");
    console.log("  6. ✓ 关闭代币账户");
    console.log("\n所有操作已成功完成！\n");
  });
});

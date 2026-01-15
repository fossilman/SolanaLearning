import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";

describe("vault", () => {
  // 配置 provider
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Vault;
  const authority = provider.wallet;

  // 计算 vault PDA 地址
  const [vaultAddress, vaultBump] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from("vault"),
      authority.publicKey.toBuffer(),
    ],
    program.programId
  );

  it("初始化金库", async () => {
    // 调用 Initialize
    await program.methods
      .initialize()
      .accounts({
        vault: vaultAddress,
        authority: authority.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // 验证状态
    const vault = await program.account.vault.fetch(vaultAddress);
    expect(vault.authority.toString()).to.equal(authority.publicKey.toString());
    expect(vault.totalDeposits.toNumber()).to.equal(0);
    expect(vault.bump).to.equal(vaultBump);
  });

  it("非所有者无法操作金库", async () => {
    const hacker = anchor.web3.Keypair.generate();
    try {
      await program.methods
        .withdraw(new BN(100))
        .accounts({
          vault: vaultAddress,
          authority: hacker.publicKey,
        })
        .signers([hacker])
        .rpc();
      expect.fail("应该失败");
    } catch (e) {
      // 期望捕获 ConstraintHasOne 错误
      expect(e.message).to.include("ConstraintHasOne");
    }
  });

  it("存款到金库", async () => {
    const depositAmount = new BN(1000_000_000); // 1 SOL

    // 获取初始余额
    const initialBalance = await provider.connection.getBalance(
      authority.publicKey
    );

    // 执行存款
    await program.methods
      .deposit(depositAmount)
      .accounts({
        vault: vaultAddress,
        authority: authority.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // 验证金库状态
    const vault = await program.account.vault.fetch(vaultAddress);
    expect(vault.totalDeposits.toNumber()).to.equal(depositAmount.toNumber());

    // 验证余额变化
    const finalBalance = await provider.connection.getBalance(
      authority.publicKey
    );
    expect(initialBalance - finalBalance).to.be.greaterThanOrEqual(
      depositAmount.toNumber()
    );
  });

  it("从金库提款", async () => {
    const withdrawAmount = new BN(500_000_000); // 0.5 SOL

    // 获取初始余额
    const initialBalance = await provider.connection.getBalance(
      authority.publicKey
    );

    // 执行提款
    await program.methods
      .withdraw(withdrawAmount)
      .accounts({
        vault: vaultAddress,
        authority: authority.publicKey,
      })
      .rpc();

    // 验证金库状态
    const vault = await program.account.vault.fetch(vaultAddress);
    expect(vault.totalDeposits.toNumber()).to.equal(500_000_000);

    // 验证余额变化
    const finalBalance = await provider.connection.getBalance(
      authority.publicKey
    );
    expect(finalBalance - initialBalance).to.be.greaterThanOrEqual(
      withdrawAmount.toNumber() - 5000 // 考虑交易费用
    );
  });

  it("不能提款超过余额", async () => {
    const excessiveAmount = new BN(10_000_000_000); // 10 SOL

    try {
      await program.methods
        .withdraw(excessiveAmount)
        .accounts({
          vault: vaultAddress,
          authority: authority.publicKey,
        })
        .rpc();
      expect.fail("应该失败");
    } catch (e) {
      // 期望捕获余额不足错误
      expect(e.message).to.include("InsufficientBalance");
    }
  });

  it("不能存款0金额", async () => {
    try {
      await program.methods
        .deposit(new BN(0))
        .accounts({
          vault: vaultAddress,
          authority: authority.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      expect.fail("应该失败");
    } catch (e) {
      // 期望捕获无效存款金额错误
      expect(e.message).to.include("InvalidDepositAmount");
    }
  });
});

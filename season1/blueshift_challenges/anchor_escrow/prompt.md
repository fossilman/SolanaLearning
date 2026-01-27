<ArticleSection name="Template" id="template" level="h2" />

这次，由于程序相当复杂，我们将其拆分为小型、专注的模块，而不是将所有内容都塞入 `lib.rs` 中。

文件夹结构大致如下：

```
src
├── instructions
│       ├── make.rs
│       ├── mod.rs
│       ├── refund.rs
│       └── take.rs
├── errors.rs
├── lib.rs
└── state.rs
```

而 `lib.rs` 将大致如下：

```rust
use anchor_lang::prelude::*;

mod state;
mod errors;
mod instructions;
use instructions::*;

declare_id!("22222222222222222222222222222222222222222222");

#[program]
pub mod blueshift_anchor_escrow {
    use super::*;

    #[instruction(discriminator = 0)]
    pub fn make(ctx: Context<Make>, seed: u64, receive: u64, amount: u64) -> Result<()> {
        //...
    }

    #[instruction(discriminator = 1)]
    pub fn take(ctx: Context<Take>) -> Result<()> {
        //...
    }

    #[instruction(discriminator = 2)]
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        //...
    }
}
```

如您所见，我们为指令实现了自定义的 discriminator。因此，请确保使用 0.31.0 或更新版本的 Anchor。

<ArticleSection name="State" id="state" level="h2" />

我们将进入 `state.rs`，其中存储了所有 `Escrow` 的数据。为此，我们将为其提供一个自定义 discriminator，并将结构体包装到 `#[account]` 宏中，如下所示：

```rust
use anchor_lang::prelude::*;

#[derive(InitSpace)]
#[account(discriminator = 1)]
pub struct Escrow {
    pub seed: u64,
    pub maker: Pubkey,
    pub mint_a: Pubkey,
    pub mint_b: Pubkey,
    pub receive: u64,
    pub bump: u8,
}
  ```

每个字段的作用：
- **seed**：在种子派生过程中使用的随机数，因此一个创建者可以使用相同的代币对打开多个托管账户；存储在链上，以便我们始终可以重新派生 PDA。
- **maker**：创建托管账户的钱包；需要用于退款和接收付款。
- **mint_a** 和 **mint_b**：交换中“给出”和“获取”两侧的 SPL 铸币地址。
- **receive**：创建者希望获得的代币 B 的数量。（金库的余额本身显示了存入的代币 A 的数量，因此我们不存储该信息。）
- **bump**：缓存的 bump 字节；动态派生它会消耗计算资源，因此我们将其保存一次。

我们可以加入更多信息，但额外的字节意味着额外的租金。仅存储必要内容可以保持存款成本低，同时仍然让程序执行所需的每一条规则。

最后，我们添加了`#[derive(InitSpace)]`宏，这样我们就不需要手动计算这个结构的租金。

<ArticleSection name="Errors" id="errors" level="h2" />

现在我们可以转到`errors.rs`文件，在那里我们将添加一些稍后会用到的错误，如下所示：

```rust
use anchor_lang::prelude::*;

#[error_code]
pub enum EscrowError {
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invalid maker")]
    InvalidMaker,
    #[msg("Invalid mint a")]
    InvalidMintA,
    #[msg("Invalid mint b")]
    InvalidMintB,
}
```

每个枚举都映射到一个清晰、易于理解的消息，当约束或`require!()`失败时，Anchor 会显示这些消息。

--------------------------------------------------------------------------------

<ArticleSection name="Make" id="make" level="h2" />

现在我们可以转到 `make` 指令，该指令位于 `make.rs` 中，并将执行以下操作：
- 初始化托管记录并存储所有条款。
- 创建金库（一个由 `escrow` 拥有的 `mint_a` 的关联代币账户 (ATA)）。
- 使用 CPI 调用 SPL-Token 程序，将创建者的 Token A 转移到该金库中。

### 账户 

在此上下文中需要的账户包括：
- `maker`：决定条款并将 `mint_a` 存入 `Escrow` 的用户
- `escrow`：持有交换条款（创建者、代币铸造、数量）的账户
- `mint_a`：`maker` 存入的代币
- `mint_b`：`maker` 想要交换的代币
- `maker_ata_a`：与 `maker` 和 `mint_a` 关联的代币账户，用于将代币存入 `vault`
- `vault`：与 `escrow` 和 `mint_a` 关联的代币账户，用于存放存入的代币
- `associated_token_program`：用于创建关联代币账户的关联代币程序
- `token_program`：用于 CPI 转账的代币程序
- `system_program`：用于创建 `Escrow` 的系统程序

结合所有约束条件，它看起来会是这样的：

```rust
#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct Make<'info> {
    #[account(mut)]
    pub maker: Signer<'info>,
    #[account(
        init,
        payer = maker,
        space = Escrow::INIT_SPACE + Escrow::DISCRIMINATOR.len(),
        seeds = [b"escrow", maker.key().as_ref(), seed.to_le_bytes().as_ref()],
        bump,
    )]
    pub escrow: Account<'info, Escrow>,

    /// Token Accounts
    #[account(
        mint::token_program = token_program
    )]
    pub mint_a: InterfaceAccount<'info, Mint>,
    #[account(
        mint::token_program = token_program
    )]
    pub mint_b: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint_a,
        associated_token::authority = maker,
        associated_token::token_program = token_program
    )]
    pub maker_ata_a: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init,
        payer = maker,
        associated_token::mint = mint_a,
        associated_token::authority = escrow,
        associated_token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    /// Programs
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}
```

**注意**：此指令仅传递一个 token_program。由于 take 操作会转移两个代币铸造的代币，我们必须确保这两个代币铸造都由同一个程序（SPL Token 或 Token-2022）拥有，否则 CPI 将失败。

### 逻辑 

初始化账户后，我们可以通过创建更小的辅助函数作为账户结构的实现，最终处理逻辑。

我们首先使用 `set_inner()` 辅助工具填充 `Escrow`，然后通过 `transfer` CPI 存入代币，如下所示：

```rust
impl<'info> Make<'info> {
    /// # Create the Escrow
    fn populate_escrow(&mut self, seed: u64, amount: u64, bump: u8) -> Result<()> {
        self.escrow.set_inner(Escrow {
            seed,
            maker: self.maker.key(),
            mint_a: self.mint_a.key(),
            mint_b: self.mint_b.key(),
            receive: amount,
            bump,
        });

        Ok(())
    }

    /// # Deposit the tokens
    fn deposit_tokens(&self, amount: u64) -> Result<()> {
        transfer_checked(
            CpiContext::new(
                self.token_program.to_account_info(),
                TransferChecked {
                    from: self.maker_ata_a.to_account_info(),
                    mint: self.mint_a.to_account_info(),
                    to: self.vault.to_account_info(),
                    authority: self.maker.to_account_info(),
                },
            ),
            amount,
            self.mint_a.decimals,
        )?;

        Ok(())
    }
}
```

我们可以看到 Anchor 在多个方面为我们提供了帮助：
- `set_inner()`：确保每个字段都已填充。
- `transfer_checked`：像我们之前使用的系统辅助工具一样封装了 Token CPI。

现在我们可以继续创建一个 `handler` 函数，在使用辅助工具之前执行一些检查，如下所示：

```rust
pub fn handler(ctx: Context<Make>, seed: u64, receive: u64, amount: u64) -> Result<()> {
    // Validate the amount
    require_gt!(receive, 0, EscrowError::InvalidAmount);
    require_gt!(amount, 0, EscrowError::InvalidAmount);

    // Save the Escrow Data
    ctx.accounts.populate_escrow(seed, receive, ctx.bumps.escrow)?;

    // Deposit Tokens
    ctx.accounts.deposit_tokens(amount)?;

    Ok(())
}
  ```

这里我们添加了两个验证检查；一个针对 `amount`，另一个针对 `receive` 参数，以确保我们不会为任一参数传递零值。

### 警告

SPL Token-2022 的某些扩展功能，例如转账钩子、保密转账、默认账户状态，可能会引入漏洞，例如阻止转账、锁定资金以及在托管逻辑、金库或 CPI 中导致资金被抽走。

- 确保 `mint_a` 和 `mint_b` 由同一个代币程序拥有，以防止 CPI 失败。
- 使用经过充分审计的代币（例如 USDC、wSOL）来自标准 SPL Token 程序。
- 避免使用未经验证或复杂的 Token-2022 铸币。

--------------------------------------------------------------------------------

<ArticleSection name="Take" id="take" level="h2" />

我们现在可以转到 `take` 指令，该指令位于 `take.rs` 中，并将执行以下操作：
- 关闭托管记录，将其租金 lamports 返还给创建者。
- 将 Token A 从保管库转移到接受者，然后关闭保管库。
- 将约定数量的 Token B 从接受者转移到创建者。

### 账户

在此上下文中需要的账户包括：
- `taker`：接受 `maker` 条款并进行交换的用户
- `maker`：最初设定条款的用户
- `escrow`：存储此交换所有条款的账户
- `mint_a`：`maker` 存入的代币
- `mint_b`：`maker` 希望交换的代币
- `vault`：与 `escrow` 和 `mint_a` 关联的代币账户，将代币发送给 `taker`
- `taker_ata_a`：与 `taker` 和 `mint_a` 关联的代币账户，将从 `vault` 接收代币
- `taker_ata_b`：与 `taker` 和 `mint_b` 关联的代币账户，将代币发送给 `maker`
- `maker_ata_b`：与 `maker` 和 `mint_b` 关联的代币账户，将接收来自 `taker` 的代币
- `associated_token_program`：用于创建关联代币账户的关联代币程序
- `token_program`：用于 CPI 转账的代币程序
- `system_program`：用于创建 `Escrow` 的系统程序

结合所有约束条件，它看起来会是这样的：

  ```rust
#[derive(Accounts)]
pub struct Take<'info> {
    #[account(mut)]
    pub taker: Signer<'info>,
    #[account(mut)]
    pub maker: SystemAccount<'info>,
    #[account(
        mut,
        close = maker,
        seeds = [b"escrow", maker.key().as_ref(), escrow.seed.to_le_bytes().as_ref()],
        bump = escrow.bump,
        has_one = maker @ EscrowError::InvalidMaker,
        has_one = mint_a @ EscrowError::InvalidMintA,
        has_one = mint_b @ EscrowError::InvalidMintB,
    )]
    pub escrow: Box<Account<'info, Escrow>>,

    /// Token Accounts
    pub mint_a: Box<InterfaceAccount<'info, Mint>>,
    pub mint_b: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = mint_a,
        associated_token::authority = escrow,
        associated_token::token_program = token_program
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = taker,
        associated_token::mint = mint_a,
        associated_token::authority = taker,
        associated_token::token_program = token_program
    )]
    pub taker_ata_a: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = mint_b,
        associated_token::authority = taker,
        associated_token::token_program = token_program
    )]
    pub taker_ata_b: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = taker,
        associated_token::mint = mint_b,
        associated_token::authority = maker,
        associated_token::token_program = token_program
    )]
    pub maker_ata_b: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Programs
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}
  ```

### 逻辑

在逻辑部分，我们首先将代币从`taker_ata_b`转移到`maker_ata_b`；然后将代币从`vault`转移到`taker_ata_a`，最后像这样关闭现在已空的保险库：

```rust
impl<'info> Take<'info> {
    fn transfer_to_maker(&mut self) -> Result<()> {
        transfer_checked(
            CpiContext::new(
                self.token_program.to_account_info(),
                TransferChecked {
                    from: self.taker_ata_b.to_account_info(),
                    to: self.maker_ata_b.to_account_info(),
                    mint: self.mint_b.to_account_info(),
                    authority: self.taker.to_account_info(),
                },
            ),
            self.escrow.receive,
            self.mint_b.decimals,
        )?;

        Ok(())
    }

    fn withdraw_and_close_vault(&mut self) -> Result<()> {
        // Create the signer seeds for the Vault
        let signer_seeds: [&[&[u8]]; 1] = [&[
            b"escrow",
            self.maker.to_account_info().key.as_ref(),
            &self.escrow.seed.to_le_bytes()[..],
            &[self.escrow.bump],
        ]];

        // Transfer Token A (Vault -> Taker)
        transfer_checked(
            CpiContext::new_with_signer(
                self.token_program.to_account_info(),
                TransferChecked {
                    from: self.vault.to_account_info(),
                    to: self.taker_ata_a.to_account_info(),
                    mint: self.mint_a.to_account_info(),
                    authority: self.escrow.to_account_info(),
                },
                &signer_seeds,
            ),
            self.vault.amount,
            self.mint_a.decimals,
        )?;

        // Close the Vault
        close_account(CpiContext::new_with_signer(
            self.token_program.to_account_info(),
            CloseAccount {
                account: self.vault.to_account_info(),
                authority: self.escrow.to_account_info(),
                destination: self.maker.to_account_info(),
            },
            &signer_seeds,
        ))?;

        Ok(())
    }
}
```

我们现在创建`handler`函数，这次幸运的是我们不需要执行任何额外的检查，因此它将如下所示：

```rust
pub fn handler(ctx: Context<Take>) -> Result<()> {
    // Transfer Token B to Maker
    ctx.accounts.transfer_to_maker()?;

    // Withdraw and close the Vault
    ctx.accounts.withdraw_and_close_vault()?;

    Ok(())
}
```

--------------------------------------------------------------------------------

<ArticleSection name="Refund" id="refund" level="h2" />

现在我们可以转到 `refund` 指令，它位于 `refund.rs` 中，并将执行以下操作：
- 关闭托管 PDA，并将其租金 lamports 返还给创建者。
- 将金库中的全部 Token A 余额转回创建者，然后关闭金库账户。

### 账户 

在此上下文中需要的账户有：
- `maker`：决定交换条款的用户
- `escrow`：存储所有交换条款的账户
- `mint_a`：`maker` 存入的代币
- `vault`：与 `escrow` 和 `mint_a` 关联的代币账户，代币已存入其中
- `maker_ata_a`：与 `maker` 和 `mint_a` 关联的代币账户，将从 `vault` 接收代币
- `associated_token_program`：用于创建关联代币账户的关联代币程序
- `token_program`：用于 CPI 转账的代币程序
- `system_program`：用于创建 `Escrow` 的系统程序

这次我们不会帮你创建 `Context`，所以请自己尝试完成！请确保使用正确的账户顺序，否则我们的测试将失败。

### 逻辑 

逻辑与 `take` 指令类似，但这次我们只是将代币从 `vault` 转移到 `maker_ata_a`，然后关闭现在已空的金库。

这次轮到你自己学习如何完成了，所以我们不会告诉你解决方案是什么。

请注意，一旦执行此操作，报价将失效，金库将被清空，创建者将其 Token A 和租金返还到他们的钱包中。

<ArticleSection name="Entrypoint" id="entrypoint" level="h2" />

现在我们已经在不同的指令中创建了所有函数，终于可以将我们创建的所有函数填充到 `lib.rs` 中；像这样：

```rust
#[program]
pub mod blueshift_anchor_escrow {
    use super::*;

    pub fn make(ctx: Context<Make>, seed: u64, receive: u64, amount: u64) -> Result<()> {
        instructions::make::handler(ctx, seed, receive, amount)
    }

    pub fn take(ctx: Context<Take>) -> Result<()> {
        instructions::take::handler(ctx)
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        instructions::refund::handler(ctx)
    }
}
```

<ArticleSection name="Conclusion" id="conclusion" level="h2" />
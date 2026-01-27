<ArticleSection name="模板" id="template" level="h2" />

让我们通过设置基本结构、账户和错误处理来构建闪电贷程序的基础，这些将被借款和还款指令共同使用。

我们将在`lib.rs`中实现所有内容，因为我们只有两个共享相同账户结构的指令。以下是包含所有基本组件的起始模板：

```rust
use anchor_lang::prelude::*;
use anchor_spl::{
  token::{Token, TokenAccount, Mint, Transfer, transfer}, 
  associated_token::AssociatedToken
}; 
use anchor_lang::{
  Discriminator,
  solana_program::sysvar::instructions::{
      ID as INSTRUCTIONS_SYSVAR_ID,
      load_instruction_at_checked
  }
};

declare_id!("22222222222222222222222222222222222222222222");

#[program]
pub mod blueshift_anchor_flash_loan {
  use super::*;

  pub fn borrow(ctx: Context<Loan>, borrow_amount: u64) -> Result<()> {
    // borrow logic...
    
    Ok(())
  }

  pub fn repay(ctx: Context<Loan>) -> Result<()> {
    // repay logic...

    Ok(())
  }
}

#[derive(Accounts)]
pub struct Loan<'info> {
  // loan accounts...
}

#[error_code]
pub enum ProtocolError {
  // error enum..
}
```

**注意**：请记得将程序 ID 更改为`22222222222222222222222222222222222222222222`，因为我们在底层使用它来测试您的程序。

<ArticleSection name="账户" id="accounts" level="h2" />

由于`borrow`和`repay`指令使用相同的账户，我们可以创建一个单一的`Loan`上下文来服务于这两个功能。这使我们的代码更易于维护和理解。

我们的`Loan`账户结构需要以下组件：
- `borrower`：请求闪电贷的用户。
- `protocol`：拥有协议流动性池的程序派生地址（PDA）。
- `mint`：被借用的特定代币。
- `borrower_ata`：借款人的关联代币账户，用于接收借用的代币。
- `protocol_ata`：协议的关联代币账户，用于提供借用的代币。
- `instructions`：用于自省的指令 Sysvar 账户。
- `token_program`、`associated_token_program`和`system_program`：程序所需的其他程序。

以下是我们定义账户结构的方法：

```rust
#[derive(Accounts)]
pub struct Loan<'info> {
  #[account(mut)]
  pub borrower: Signer<'info>,
  #[account(
    seeds = [b"protocol".as_ref()],
    bump,
  )]
  pub protocol: SystemAccount<'info>,

  pub mint: Account<'info, Mint>,
  #[account(
    init_if_needed,
    payer = borrower,
    associated_token::mint = mint,
    associated_token::authority = borrower,
  )]
  pub borrower_ata: Account<'info, TokenAccount>,
  #[account(
    mut,
    associated_token::mint = mint,
    associated_token::authority = protocol,
  )]
  pub protocol_ata: Account<'info, TokenAccount>,

  #[account(address = INSTRUCTIONS_SYSVAR_ID)]
  /// CHECK: InstructionsSysvar account
  instructions: UncheckedAccount<'info>,
  pub token_program: Program<'info, Token>,
  pub associated_token_program: Program<'info, AssociatedToken>,
  pub system_program: Program<'info, System>
}
```

如您所见，此指令所需的账户及其约束条件非常直观：
- `protocol`：使用`seeds = [b"protocol".as_ref()]`创建一个确定性的地址，该地址拥有所有协议流动性。这确保了只有我们的程序可以控制这些资金。
- `borrower_ata`：使用`init_if_needed`，因为借款人可能尚未为此特定代币创建关联的代币账户。如果需要，约束条件会自动创建一个。
- `protocol_ata`：必须已经存在并且是可变的，因为我们将从中转移代币。`associated_token::authority = protocol`约束条件确保只有协议PDA可以授权转移。
- `instructions`：使用`address`约束条件来验证我们正在访问包含交易指令数据的正确系统账户。

<ArticleSection name="错误" id="errors" level="h2" />

闪电贷在多个步骤中需要精确验证，因此我们需要全面的错误处理。以下是完整的错误枚举：

```rust
#[error_code]
pub enum ProtocolError {
    #[msg("Invalid instruction")]
    InvalidIx,
    #[msg("Invalid instruction index")]
    InvalidInstructionIndex,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Not enough funds")]
    NotEnoughFunds,
    #[msg("Program Mismatch")]
    ProgramMismatch,
    #[msg("Invalid program")]
    InvalidProgram,
    #[msg("Invalid borrower ATA")]
    InvalidBorrowerAta,
    #[msg("Invalid protocol ATA")]
    InvalidProtocolAta,
    #[msg("Missing repay instruction")]
    MissingRepayIx,
    #[msg("Missing borrow instruction")]
    MissingBorrowIx,
    #[msg("Overflow")]
    Overflow,
}
```

现在，检验一下你所学的内容吧。使用 Anchor 框架构建一个满足以下要求的闪电贷程序：

挑战 1：创建一个 `borrow` 指令
你的程序应允许借款人从协议中借款，并检查交易末尾是否存在一个 repay 指令。

挑战 2：创建一个 `repay` 指令
你的程序应在交易末尾检查 borrowed_amount，并以正确的金额偿还协议。
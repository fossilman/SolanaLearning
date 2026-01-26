
<ArticleSection name="账户" id="accounts" level="h2" />

由于两个指令使用相同的账户，为了更简洁和易读，我们可以创建一个名为 `VaultAction` 的上下文，并将其用于 `deposit` 和 `withdraw`。

`VaultAction` 账户结构需要包含以下内容：
- `signer`：这是保险库的所有者，也是创建保险库后唯一可以提取 lamports 的人。
- `vault`：一个由以下种子派生的 PDA：`[b"vault", signer.key().as_ref()]`，用于为签名者存储 lamports。
- `system_program`：系统程序账户，需要包含它，因为我们将使用系统程序的转账指令 CPI。

以下是我们定义账户结构的方法：

```rust
#[derive(Accounts)]
pub struct VaultAction<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"vault", signer.key().as_ref()],
        bump,
    )]
    pub vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}
```

让我们逐一解析每个账户约束：

1. `signer`：需要使用`mut`约束，因为我们将在转账过程中修改其 lamports。
2. `vault`：
    - `mut`，因为我们将在转账过程中修改其 lamports。
    - `seeds` 和 `bumps` 定义了如何从种子派生出有效的 PDA。
3. `system_program`：检查账户是否设置为可执行，并且地址是否为系统程序地址。

<ArticleSection name="Errors" id="errors" level="h2" />

对于这个小程序，我们不需要太多错误处理，因此我们只创建两个枚举：
- `VaultAlreadyExists`：用于判断账户中是否已经有 lamports，因为这意味着金库已经存在。
- `InvalidAmount`：我们不能存入少于基本账户最低租金的金额，因此我们检查金额是否大于该值。

它看起来会像这样：

```rust
#[error_code]
pub enum VaultError {
    #[msg("Vault already exists")]
    VaultAlreadyExists,
    #[msg("Invalid amount")]
    InvalidAmount,
}
```

<ArticleSection name="Deposit" id="deposit" level="h2" />

存款指令执行以下步骤：
1. 验证金库为空（lamports 为零），以防止重复存款
2. 确保存款金额超过 `SystemAccount` 的免租金最低限额
3. 使用 CPI 调用系统程序，将 lamports 从签名者转移到金库

让我们先实现这些检查：

```rust
// Check if vault is empty
require_eq!(ctx.accounts.vault.lamports(), 0, VaultError::VaultAlreadyExists);

// Ensure amount exceeds rent-exempt minimum
require_gt!(amount, Rent::get()?.minimum_balance(0), VaultError::InvalidAmount);
```

两个 `require` 宏充当自定义保护子句：
- `require_eq!` 确认金库为空（防止重复存款）。
- `require_gt!` 检查金额是否超过免租金阈值。

一旦检查通过，Anchor 的系统程序助手会像这样调用 `Transfer` CPI：

```rust
use anchor_lang::system_program::{transfer, Transfer};

transfer(
    CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        Transfer {
            from: ctx.accounts.signer.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
        },
    ),
    amount,
)?;
```

<ArticleSection name="Withdraw" id="withdraw" level="h2" />

取款指令执行以下步骤：
1. 验证保险库中是否有 lamports（不为空）
2. 使用保险库的 PDA 以其自身名义签署转账
3. 将保险库中的所有 lamports 转回到签署者

首先，让我们检查保险库中是否有可取出的 lamports：

```rust
// Check if vault has any lamports
require_neq!(ctx.accounts.vault.lamports(), 0, VaultError::InvalidAmount);
```

然后，我们需要创建 PDA 签名者种子并执行转账：

```rust
// Create PDA signer seeds
let signer_key = ctx.accounts.signer.key();
let signer_seeds = &[b"vault", signer_key.as_ref(), &[ctx.bumps.vault]];

// Transfer all lamports from vault to signer
transfer(
    CpiContext::new_with_signer(
        ctx.accounts.system_program.to_account_info(),
        Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.signer.to_account_info(),
        },
        &[&signer_seeds[..]]
    ),
    ctx.accounts.vault.lamports()
)?;
```

此次取款的安全性由以下两个因素保证：
1. 保险库的 PDA 是使用签署者的公钥派生的，确保只有原始存款人可以取款
2. PDA 签署转账的能力通过我们提供给 `CpiContext::new_with_signer` 的种子进行验证
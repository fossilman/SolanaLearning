use anchor_lang::prelude::*;
use crate::state::Vault;
use crate::errors::VaultError;

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        mut,
        seeds = [Vault::SEED_PREFIX, authority.key().as_ref()],
        bump = vault.bump,
        has_one = authority // 安全检查：调用者必须是金库主人
    )]
    pub vault: Account<'info, Vault>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    
    // 检查金库是否已暂停
    require!(!vault.is_paused, VaultError::VaultPaused);

    // 1. 计算最大可提款金额 (当前余额 - 租金豁免门槛)
    let rent = Rent::get()?;
    let min_balance = rent.minimum_balance(vault.to_account_info().data_len());
    
    let current_lamports = vault.to_account_info().lamports();
    let available_amount = current_lamports.checked_sub(min_balance).unwrap_or(0);

    require!(amount <= available_amount, VaultError::InsufficientBalance);

    // 2. 执行转账 (直接修改 Lamports)
    // 因为 vault 账户的 Owner 是当前程序，所以我们有权修改它的 lamports
    **vault.to_account_info().try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.authority.try_borrow_mut_lamports()? += amount;

    // 3. 更新记账
    vault.total_deposits = vault.total_deposits.checked_sub(amount).ok_or(VaultError::Overflow)?;

    msg!("提款成功: {} lamports", amount);
    Ok(())
}

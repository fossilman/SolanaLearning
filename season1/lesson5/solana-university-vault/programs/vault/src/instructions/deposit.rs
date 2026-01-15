use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use crate::state::Vault;
use crate::errors::VaultError;

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        mut,
        seeds = [Vault::SEED_PREFIX, authority.key().as_ref()],
        bump = vault.bump,
        has_one = authority // 安全检查：调用者必须是金库主人
    )]
    pub vault: Account<'info, Vault>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, VaultError::InvalidDepositAmount);

    // CPI: System Program Transfer (User -> Vault PDA)
    let cpi_accounts = Transfer {
        from: ctx.accounts.authority.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.system_program.to_account_info(), cpi_accounts);
    
    transfer(cpi_ctx, amount)?;

    // 更新内部记账
    let vault = &mut ctx.accounts.vault;
    vault.total_deposits = vault.total_deposits.checked_add(amount).ok_or(VaultError::Overflow)?;

    msg!("存款成功: {} lamports", amount);
    Ok(())
}
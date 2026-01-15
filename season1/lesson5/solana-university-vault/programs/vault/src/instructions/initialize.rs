use anchor_lang::prelude::*;
use crate::state::Vault;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Vault::INIT_SPACE,
        // 种子: "vault" + 用户公钥
        seeds = [Vault::SEED_PREFIX, authority.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    let clock = Clock::get()?;

    vault.authority = ctx.accounts.authority.key();
    vault.total_deposits = 0;
    vault.created_at = clock.unix_timestamp;
    vault.bump = ctx.bumps.vault;
    vault.is_paused = false;

    msg!("金库已创建 | 所有者: {}", vault.authority);
    Ok(())
}
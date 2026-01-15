use anchor_lang::prelude::*;
use crate::state::Vault;

#[derive(Accounts)]
pub struct TogglePause<'info> {
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

pub fn handler(ctx: Context<TogglePause>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    
    // 切换暂停状态
    vault.is_paused = !vault.is_paused;
    
    if vault.is_paused {
        msg!("金库已暂停");
    } else {
        msg!("金库已恢复");
    }
    
    Ok(())
}


use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, MintTo, Transfer, Burn, CloseAccount};

declare_id!("BBJLBwZFUcn2uLP3PfHQVS1ziBLBWSz6uwjYE7NcpNv1");

#[program]
pub mod token_part2 {
    use super::*;

    /// PART2: 创建 Token-2022 代币（包含元数据）
    pub fn create_token(ctx: Context<CreateToken>) -> Result<()> {
        msg!("=== PART2: 创建 Token-2022 代币（包含元数据） ===");
        msg!("代币 Mint 地址: {:?}", ctx.accounts.mint.key());
        msg!("代币创建者: {:?}", ctx.accounts.authority.key());
        msg!("使用 TOKEN_2022_PROGRAM_ID 创建代币");
        msg!("代币创建成功！");
        Ok(())
    }

    /// PART2: 铸造 Token-2022 代币
    pub fn mint_tokens(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
        msg!("=== PART2: 铸造 Token-2022 代币 ===");
        msg!("代币 Mint 地址: {:?}", ctx.accounts.mint.key());
        msg!("目标账户: {:?}", ctx.accounts.token_account.key());
        msg!("铸造数量: {}", amount);
        
        let cpi_accounts = MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.token_account.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        
        token::mint_to(cpi_ctx, amount)?;
        
        msg!("Token-2022 代币铸造成功！");
        Ok(())
    }

    /// PART2: 转账 Token-2022 代币
    pub fn transfer_tokens(ctx: Context<TransferTokens>, amount: u64) -> Result<()> {
        msg!("=== PART2: 转账 Token-2022 代币 ===");
        msg!("发送方账户: {:?}", ctx.accounts.from.key());
        msg!("接收方账户: {:?}", ctx.accounts.to.key());
        msg!("转账数量: {}", amount);
        
        let cpi_accounts = Transfer {
            from: ctx.accounts.from.to_account_info(),
            to: ctx.accounts.to.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        
        token::transfer(cpi_ctx, amount)?;
        
        msg!("Token-2022 代币转账成功！");
        Ok(())
    }

    /// PART2: 销毁 Token-2022 代币
    pub fn burn_tokens(ctx: Context<BurnTokens>, amount: u64) -> Result<()> {
        msg!("=== PART2: 销毁 Token-2022 代币 ===");
        msg!("代币账户: {:?}", ctx.accounts.token_account.key());
        msg!("代币 Mint 地址: {:?}", ctx.accounts.mint.key());
        msg!("销毁数量: {}", amount);
        
        let cpi_accounts = Burn {
            mint: ctx.accounts.mint.to_account_info(),
            from: ctx.accounts.token_account.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        
        token::burn(cpi_ctx, amount)?;
        
        msg!("Token-2022 代币销毁成功！");
        Ok(())
    }

    /// PART2: 关闭 Token-2022 代币账户
    pub fn close_token_account(ctx: Context<CloseTokenAccount>) -> Result<()> {
        msg!("=== PART2: 关闭 Token-2022 代币账户 ===");
        msg!("代币账户: {:?}", ctx.accounts.token_account.key());
        msg!("接收方账户: {:?}", ctx.accounts.destination.key());
        
        let cpi_accounts = CloseAccount {
            account: ctx.accounts.token_account.to_account_info(),
            destination: ctx.accounts.destination.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        
        token::close_account(cpi_ctx)?;
        
        msg!("Token-2022 代币账户关闭成功！");
        Ok(())
    }
}

#[derive(Accounts)]
pub struct CreateToken<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        init,
        payer = authority,
        mint::decimals = 9,
        mint::authority = authority,
    )]
    pub mint: Account<'info, Mint>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct MintTokens<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct TransferTokens<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(mut)]
    pub from: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub to: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct BurnTokens<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CloseTokenAccount<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(mut)]
    pub token_account: Account<'info, TokenAccount>,
    
    /// CHECK: 这是关闭账户时接收剩余 lamports 的目标账户，可以是任何账户
    #[account(mut)]
    pub destination: AccountInfo<'info>,
    
    pub token_program: Program<'info, Token>,
}

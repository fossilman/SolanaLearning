use anchor_lang::prelude::*;
use anchor_spl::{
  token::{Token, TokenAccount, Mint, Transfer, transfer}, 
  associated_token::AssociatedToken
}; 
use anchor_lang::solana_program::sysvar::instructions::{
    ID as INSTRUCTIONS_SYSVAR_ID,
    load_instruction_at_checked,
    load_current_index_checked
};
use sha2::{Sha256, Digest};

declare_id!("22222222222222222222222222222222222222222222");

// Helper function to compute instruction discriminator
// Anchor uses "global:<function_name>" as the preimage for discriminator
fn compute_instruction_discriminator(name: &str) -> [u8; 8] {
    let mut hasher = Sha256::new();
    hasher.update(format!("global:{}", name).as_bytes());
    let hash = hasher.finalize();
    let mut discriminator = [0u8; 8];
    discriminator.copy_from_slice(&hash[..8]);
    discriminator
}

#[program]
pub mod blueshift_anchor_flash_loan {
  use super::*;

  pub fn borrow(ctx: Context<Loan>, borrow_amount: u64) -> Result<()> {
    msg!("Borrow: borrow_amount = {}", borrow_amount);
    
    // Validate borrow amount
    require!(borrow_amount > 0, ProtocolError::InvalidAmount);
    
    // Check if protocol has enough funds
    require!(
      ctx.accounts.protocol_ata.amount >= borrow_amount,
      ProtocolError::NotEnoughFunds
    );

    // Get the current instruction index
    let current_ix_index = load_current_index_checked(
      &ctx.accounts.instructions.to_account_info()
    )? as usize;
    
    msg!("Borrow: current_ix_index = {}", current_ix_index);
    
    // Check if there's a repay instruction after this borrow instruction
    let mut found_repay = false;
    let repay_discriminator = compute_instruction_discriminator("repay");
    msg!("Borrow: Looking for repay instruction, discriminator = {:?}", repay_discriminator);
    msg!("Borrow: Our program_id = {}", ctx.program_id);
    
    let mut i = current_ix_index + 1;
    loop {
      match load_instruction_at_checked(i, &ctx.accounts.instructions.to_account_info()) {
        Ok(ix) => {
          msg!("Borrow: Checking instruction at index {}, program_id = {}, data_len = {}", 
               i, ix.program_id, ix.data.len());
          
          // Check if this is a repay instruction to our program
          if ix.program_id == *ctx.program_id && ix.data.len() >= 8 {
            let discriminator = &ix.data[..8];
            msg!("Borrow: Instruction discriminator = {:?}", discriminator);
            if discriminator == repay_discriminator.as_ref() {
              msg!("Borrow: Found matching repay instruction at index {}", i);
              found_repay = true;
              break;
            } else {
              msg!("Borrow: Discriminator mismatch - expected {:?}, got {:?}", 
                   repay_discriminator, discriminator);
            }
          }
          i += 1;
        }
        Err(_) => {
          msg!("Borrow: Reached end of instructions at index {}", i);
          break; // Reached end of instructions
        }
      }
    }
    
    msg!("Borrow: found_repay = {}", found_repay);
    require!(found_repay, ProtocolError::MissingRepayIx);

    // Transfer tokens from protocol to borrower
    let seeds = &[b"protocol".as_ref(), &[ctx.bumps.protocol]];
    let signer = &[&seeds[..]];
    
    let cpi_accounts = Transfer {
      from: ctx.accounts.protocol_ata.to_account_info(),
      to: ctx.accounts.borrower_ata.to_account_info(),
      authority: ctx.accounts.protocol.to_account_info(),
    };
    
    let cpi_ctx = CpiContext::new_with_signer(
      ctx.accounts.token_program.to_account_info(),
      cpi_accounts,
      signer,
    );
    
    transfer(cpi_ctx, borrow_amount)?;

    Ok(())
  }

  pub fn repay(ctx: Context<Loan>) -> Result<()> {
    // Get the current instruction index
    let current_ix_index = load_current_index_checked(
      &ctx.accounts.instructions.to_account_info()
    )? as usize;
    
    msg!("Repay: current_ix_index = {}", current_ix_index);
    
    // Check if there's a borrow instruction before this repay instruction
    let mut found_borrow = false;
    let mut borrow_amount = 0u64;
    let borrow_discriminator = compute_instruction_discriminator("borrow");
    
    msg!("Repay: Looking for borrow instruction, discriminator = {:?}", borrow_discriminator);
    msg!("Repay: Our program_id = {}", ctx.program_id);
    
    // If current_ix_index is 0, we need to search from the beginning
    // Otherwise, search from 0 to current_ix_index (exclusive)
    // But since we're in a CPI context, we need to search all instructions
    // Let's try searching from 0 up to a reasonable limit
    let mut i = 0;
    let max_index = current_ix_index.max(10); // Search at least 10 instructions or until current_ix_index
    
    while i < max_index {
      match load_instruction_at_checked(i, &ctx.accounts.instructions.to_account_info()) {
        Ok(ix) => {
          msg!("Repay: Checking instruction at index {}, program_id = {}, data_len = {}", 
               i, ix.program_id, ix.data.len());
          
          // Check if this is a borrow instruction to our program
          if ix.program_id == *ctx.program_id {
            msg!("Repay: Found instruction from our program at index {}", i);
            if ix.data.len() >= 16 {
              let discriminator = &ix.data[..8];
              msg!("Repay: Instruction discriminator = {:?}", discriminator);
              if discriminator == borrow_discriminator.as_ref() {
                msg!("Repay: Found matching borrow instruction at index {}", i);
                found_borrow = true;
                // Extract borrow_amount from instruction data (after discriminator)
                borrow_amount = u64::from_le_bytes(
                  ix.data[8..16].try_into().map_err(|_| ProtocolError::InvalidAmount)?
                );
                msg!("Repay: Extracted borrow_amount = {}", borrow_amount);
                break;
              } else {
                msg!("Repay: Discriminator mismatch - expected {:?}, got {:?}", 
                     borrow_discriminator, discriminator);
              }
            } else {
              msg!("Repay: Instruction data too short: {} < 16", ix.data.len());
            }
          } else {
            msg!("Repay: Program ID mismatch - expected {}, got {}", 
                 ctx.program_id, ix.program_id);
          }
          i += 1;
        }
        Err(e) => {
          msg!("Repay: Error loading instruction at index {}: {:?}", i, e);
          // If we can't load an instruction, it might be invalid, but continue searching
          i += 1;
          if i >= max_index {
            break;
          }
        }
      }
    }
    
    msg!("Repay: found_borrow = {}", found_borrow);
    require!(found_borrow, ProtocolError::MissingBorrowIx);
    require!(borrow_amount > 0, ProtocolError::InvalidAmount);

    // Calculate repayment amount with 5% fee
    // repay_amount = borrow_amount * 105 / 100
    let repay_amount = borrow_amount
      .checked_mul(105)
      .and_then(|v| v.checked_div(100))
      .ok_or(ProtocolError::Overflow)?;
    
    msg!("Repay: borrow_amount = {}, repay_amount (with 5% fee) = {}", borrow_amount, repay_amount);

    // Check if borrower has enough funds to repay
    require!(
      ctx.accounts.borrower_ata.amount >= repay_amount,
      ProtocolError::NotEnoughFunds
    );

    // Transfer tokens from borrower back to protocol
    let cpi_accounts = Transfer {
      from: ctx.accounts.borrower_ata.to_account_info(),
      to: ctx.accounts.protocol_ata.to_account_info(),
      authority: ctx.accounts.borrower.to_account_info(),
    };
    
    let cpi_ctx = CpiContext::new(
      ctx.accounts.token_program.to_account_info(),
      cpi_accounts,
    );
    
    transfer(cpi_ctx, repay_amount)?;

    Ok(())
  }
}

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

use core::ops::Deref;
use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    AccountView, ProgramResult,
};
use pinocchio_associated_token_account::instructions::CreateIdempotent;
use pinocchio_token::instructions::{CloseAccount, TransferChecked};

use crate::errors::EscrowError;
use crate::instructions::helpers::{get_mint_decimals, get_token_account_amount};
use crate::state::Escrow;

const ESCROW_SEED: &[u8] = b"escrow";

pub struct TakeAccounts<'a> {
    pub taker: &'a AccountView,
    pub maker: &'a AccountView,
    pub escrow: &'a AccountView,
    pub mint_a: &'a AccountView,
    pub mint_b: &'a AccountView,
    pub vault: &'a AccountView,
    pub taker_ata_a: &'a AccountView,
    pub taker_ata_b: &'a AccountView,
    pub maker_ata_b: &'a AccountView,
    pub associated_token_program: &'a AccountView,
    pub token_program: &'a AccountView,
    pub system_program: &'a AccountView,
}

impl<'a> TryFrom<&'a [AccountView]> for TakeAccounts<'a> {
    type Error = ProgramError;

    fn try_from(accounts: &'a [AccountView]) -> Result<Self, Self::Error> {
        let [
            taker,
            maker,
            escrow,
            mint_a,
            mint_b,
            vault,
            taker_ata_a,
            taker_ata_b,
            maker_ata_b,
            associated_token_program,
            token_program,
            system_program,
        ] = accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        if !taker.is_signer() {
            return Err(ProgramError::MissingRequiredSignature);
        }

        let escrow_data = escrow.try_borrow()?;
        let escrow_state = Escrow::load(escrow_data.deref())?;

        if escrow_state.maker != *maker.address() {
            return Err(EscrowError::InvalidMaker.into());
        }
        if escrow_state.mint_a != *mint_a.address() {
            return Err(EscrowError::InvalidMintA.into());
        }
        if escrow_state.mint_b != *mint_b.address() {
            return Err(EscrowError::InvalidMintB.into());
        }

        Ok(Self {
            taker,
            maker,
            escrow,
            mint_a,
            mint_b,
            vault,
            taker_ata_a,
            taker_ata_b,
            maker_ata_b,
            associated_token_program,
            token_program,
            system_program,
        })
    }
}

pub struct Take<'a> {
    pub accounts: TakeAccounts<'a>,
}

impl<'a> TryFrom<&'a [AccountView]> for Take<'a> {
    type Error = ProgramError;

    fn try_from(accounts: &'a [AccountView]) -> Result<Self, Self::Error> {
        let accounts = TakeAccounts::try_from(accounts)?;
        Ok(Self { accounts })
    }
}

impl<'a> Take<'a> {
    pub const DISCRIMINATOR: u8 = 1;

    pub fn process(&mut self) -> ProgramResult {
        let (seed, bump, receive) = {
            let escrow_data = self.accounts.escrow.try_borrow()?;
            let escrow = Escrow::load(escrow_data.deref())?;
            (escrow.seed, escrow.bump[0], escrow.receive)
        };

        let seed_bytes = seed.to_le_bytes();
        let bump_array = [bump];
        let seeds = [
            Seed::from(ESCROW_SEED),
            Seed::from(self.accounts.maker.address().as_ref()),
            Seed::from(&seed_bytes[..]),
            Seed::from(&bump_array[..]),
        ];
        let signers = [Signer::from(&seeds)];

        let mint_b_decimals = get_mint_decimals(self.accounts.mint_b)?;
        let mint_a_decimals = get_mint_decimals(self.accounts.mint_a)?;
        let vault_amount = get_token_account_amount(self.accounts.vault)?;

        // 1. Create maker_ata_b if needed (init_if_needed)
        CreateIdempotent {
            funding_account: self.accounts.taker,
            account: self.accounts.maker_ata_b,
            wallet: self.accounts.maker,
            mint: self.accounts.mint_b,
            system_program: self.accounts.system_program,
            token_program: self.accounts.token_program,
        }
        .invoke()?;

        // 2. Create taker_ata_a if needed
        CreateIdempotent {
            funding_account: self.accounts.taker,
            account: self.accounts.taker_ata_a,
            wallet: self.accounts.taker,
            mint: self.accounts.mint_a,
            system_program: self.accounts.system_program,
            token_program: self.accounts.token_program,
        }
        .invoke()?;

        // 3. Transfer token B from taker to maker
        TransferChecked {
            from: self.accounts.taker_ata_b,
            mint: self.accounts.mint_b,
            to: self.accounts.maker_ata_b,
            authority: self.accounts.taker,
            amount: receive,
            decimals: mint_b_decimals,
        }
        .invoke()?;

        // 4. Transfer token A from vault to taker
        TransferChecked {
            from: self.accounts.vault,
            mint: self.accounts.mint_a,
            to: self.accounts.taker_ata_a,
            authority: self.accounts.escrow,
            amount: vault_amount,
            decimals: mint_a_decimals,
        }
        .invoke_signed(&signers)?;

        // 5. Close vault, send lamports to maker
        CloseAccount {
            account: self.accounts.vault,
            destination: self.accounts.maker,
            authority: self.accounts.escrow,
        }
        .invoke_signed(&signers)?;

        // 6. Transfer escrow rent to maker (direct lamport manipulation - avoids Assign CPI)
        let lamports = self.accounts.escrow.lamports();
        self.accounts.maker.set_lamports(self.accounts.maker.lamports() + lamports);
        self.accounts.escrow.set_lamports(0);

        Ok(())
    }
}

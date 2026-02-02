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

pub struct RefundAccounts<'a> {
    pub maker: &'a AccountView,
    pub escrow: &'a AccountView,
    pub mint_a: &'a AccountView,
    pub vault: &'a AccountView,
    pub maker_ata_a: &'a AccountView,
    pub associated_token_program: &'a AccountView,
    pub token_program: &'a AccountView,
    pub system_program: &'a AccountView,
}

impl<'a> TryFrom<&'a [AccountView]> for RefundAccounts<'a> {
    type Error = ProgramError;

    fn try_from(accounts: &'a [AccountView]) -> Result<Self, Self::Error> {
        let [
            maker,
            escrow,
            mint_a,
            vault,
            maker_ata_a,
            associated_token_program,
            token_program,
            system_program,
        ] = accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        if !maker.is_signer() {
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

        Ok(Self {
            maker,
            escrow,
            mint_a,
            vault,
            maker_ata_a,
            associated_token_program,
            token_program,
            system_program,
        })
    }
}

pub struct Refund<'a> {
    pub accounts: RefundAccounts<'a>,
}

impl<'a> TryFrom<&'a [AccountView]> for Refund<'a> {
    type Error = ProgramError;

    fn try_from(accounts: &'a [AccountView]) -> Result<Self, Self::Error> {
        let accounts = RefundAccounts::try_from(accounts)?;
        Ok(Self { accounts })
    }
}

impl<'a> Refund<'a> {
    pub const DISCRIMINATOR: u8 = 2;

    pub fn process(&mut self) -> ProgramResult {
        let (seed, bump) = {
            let escrow_data = self.accounts.escrow.try_borrow()?;
            let escrow = Escrow::load(escrow_data.deref())?;
            (escrow.seed, escrow.bump[0])
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

        let mint_a_decimals = get_mint_decimals(self.accounts.mint_a)?;
        let vault_amount = get_token_account_amount(self.accounts.vault)?;

        // 1. Create maker_ata_a if needed (init_if_needed)
        CreateIdempotent {
            funding_account: self.accounts.maker,
            account: self.accounts.maker_ata_a,
            wallet: self.accounts.maker,
            mint: self.accounts.mint_a,
            system_program: self.accounts.system_program,
            token_program: self.accounts.token_program,
        }
        .invoke()?;

        // 2. Transfer token A from vault to maker
        TransferChecked {
            from: self.accounts.vault,
            mint: self.accounts.mint_a,
            to: self.accounts.maker_ata_a,
            authority: self.accounts.escrow,
            amount: vault_amount,
            decimals: mint_a_decimals,
        }
        .invoke_signed(&signers)?;

        // 3. Close vault, send lamports to maker
        CloseAccount {
            account: self.accounts.vault,
            destination: self.accounts.maker,
            authority: self.accounts.escrow,
        }
        .invoke_signed(&signers)?;

        // 4. Transfer escrow rent to maker (direct lamport manipulation - avoids Assign CPI)
        let lamports = self.accounts.escrow.lamports();
        self.accounts.maker.set_lamports(self.accounts.maker.lamports() + lamports);
        self.accounts.escrow.set_lamports(0);

        Ok(())
    }
}

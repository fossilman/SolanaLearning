use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    AccountView, Address, ProgramResult,
};
use pinocchio_associated_token_account::instructions::Create;
use pinocchio_system::create_account_with_minimum_balance_signed;
use pinocchio_token::instructions::TransferChecked;

use crate::errors::EscrowError;
use crate::state::Escrow;
use crate::{instructions::helpers::get_mint_decimals, ID};

const ESCROW_SEED: &[u8] = b"escrow";

pub struct MakeAccounts<'a> {
    pub maker: &'a AccountView,
    pub escrow: &'a AccountView,
    pub mint_a: &'a AccountView,
    pub mint_b: &'a AccountView,
    pub maker_ata_a: &'a AccountView,
    pub vault: &'a AccountView,
    pub associated_token_program: &'a AccountView,
    pub token_program: &'a AccountView,
    pub system_program: &'a AccountView,
}

impl<'a> TryFrom<&'a [AccountView]> for MakeAccounts<'a> {
    type Error = ProgramError;

    fn try_from(accounts: &'a [AccountView]) -> Result<Self, Self::Error> {
        let [
            maker,
            escrow,
            mint_a,
            mint_b,
            maker_ata_a,
            vault,
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

        Ok(Self {
            maker,
            escrow,
            mint_a,
            mint_b,
            maker_ata_a,
            vault,
            associated_token_program,
            token_program,
            system_program,
        })
    }
}

pub struct MakeInstructionData {
    pub seed: u64,
    pub receive: u64,
    pub amount: u64,
}

impl<'a> TryFrom<&'a [u8]> for MakeInstructionData {
    type Error = ProgramError;

    fn try_from(data: &'a [u8]) -> Result<Self, Self::Error> {
        // seed (8) + receive (8) + amount (8) = 24 bytes
        if data.len() < 24 {
            return Err(ProgramError::InvalidInstructionData);
        }

        let seed = u64::from_le_bytes(data[0..8].try_into().unwrap());
        let receive = u64::from_le_bytes(data[8..16].try_into().unwrap());
        let amount = u64::from_le_bytes(data[16..24].try_into().unwrap());

        if receive == 0 || amount == 0 {
            return Err(EscrowError::InvalidAmount.into());
        }

        Ok(Self {
            seed,
            receive,
            amount,
        })
    }
}

pub struct Make<'a> {
    pub accounts: MakeAccounts<'a>,
    pub instruction_data: MakeInstructionData,
}

impl<'a> TryFrom<(&'a [u8], &'a [AccountView])> for Make<'a> {
    type Error = ProgramError;

    fn try_from((data, accounts): (&'a [u8], &'a [AccountView])) -> Result<Self, Self::Error> {
        let accounts = MakeAccounts::try_from(accounts)?;
        let instruction_data = MakeInstructionData::try_from(data)?;

        // Verify escrow PDA
        let (escrow_pda, _bump) = Address::find_program_address(
            &[
                ESCROW_SEED,
                accounts.maker.address().as_ref(),
                &instruction_data.seed.to_le_bytes()[..],
            ],
            &ID,
        );
        if accounts.escrow.address() != &escrow_pda {
            return Err(ProgramError::InvalidArgument);
        }

        Ok(Self {
            accounts,
            instruction_data,
        })
    }
}

impl<'a> Make<'a> {
    pub const DISCRIMINATOR: u8 = 0;

    pub fn process(&mut self) -> ProgramResult {
        let (_, bump) = Address::find_program_address(
            &[
                ESCROW_SEED,
                self.accounts.maker.address().as_ref(),
                &self.instruction_data.seed.to_le_bytes()[..],
            ],
            &ID,
        );

        // 1. Create escrow PDA account
        let seed_bytes = self.instruction_data.seed.to_le_bytes();
        let bump_array = [bump];
        let seeds = [
            Seed::from(ESCROW_SEED),
            Seed::from(self.accounts.maker.address().as_ref()),
            Seed::from(&seed_bytes[..]),
            Seed::from(&bump_array[..]),
        ];
        let signers = [Signer::from(&seeds)];

        create_account_with_minimum_balance_signed(
            self.accounts.escrow,
            Escrow::LEN,
            &ID,
            self.accounts.maker,
            None,
            &signers,
        )?;

        // 2. Initialize escrow state
        {
            let mut escrow_data = self.accounts.escrow.try_borrow_mut()?;
            let escrow = Escrow::load_mut(&mut *escrow_data)?;
            escrow.set_inner(
                self.instruction_data.seed,
                self.accounts.maker.address().clone(),
                self.accounts.mint_a.address().clone(),
                self.accounts.mint_b.address().clone(),
                self.instruction_data.receive,
                [bump],
            );
        }

        // 3. Create vault ATA
        Create {
            funding_account: self.accounts.maker,
            account: self.accounts.vault,
            wallet: self.accounts.escrow,
            mint: self.accounts.mint_a,
            system_program: self.accounts.system_program,
            token_program: self.accounts.token_program,
        }
        .invoke()?;

        // 4. Transfer tokens from maker to vault
        let decimals = get_mint_decimals(self.accounts.mint_a)?;
        TransferChecked {
            from: self.accounts.maker_ata_a,
            mint: self.accounts.mint_a,
            to: self.accounts.vault,
            authority: self.accounts.maker,
            amount: self.instruction_data.amount,
            decimals,
        }
        .invoke()?;

        Ok(())
    }
}

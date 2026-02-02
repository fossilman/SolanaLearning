use core::mem::size_of;

use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    AccountView, Address, ProgramResult,
};
use pinocchio_system::create_account_with_minimum_balance_signed;
use pinocchio_token::instructions::InitializeMint2;

use crate::state::Config;

const CONFIG_SEED: &[u8] = b"config";
const LP_MINT_SEED: &[u8] = b"mint_lp";
const SPL_MINT_SIZE: usize = 82;
const LP_DECIMALS: u8 = 6;

/// Blueshift 测试: 5 个账户 - initializer, mint_lp, config, system_program, token_program
pub struct InitializeAccounts<'a> {
    pub initializer: &'a AccountView,
    pub mint_lp: &'a AccountView,
    pub config: &'a AccountView,
    pub system_program: &'a AccountView,
    pub token_program: &'a AccountView,
}

impl<'a> TryFrom<&'a [AccountView]> for InitializeAccounts<'a> {
    type Error = ProgramError;

    fn try_from(accounts: &'a [AccountView]) -> Result<Self, Self::Error> {
        let [initializer, mint_lp, config, system_program, token_program] = accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        if !initializer.is_signer() {
            return Err(ProgramError::MissingRequiredSignature);
        }

        Ok(Self {
            initializer,
            mint_lp,
            config,
            system_program,
            token_program,
        })
    }
}

/// Instruction data: seed(8) + fee(2) + mint_x(32) + mint_y(32) + config_bump(1) + lp_bump(1) + authority(32) = 108 bytes
pub struct InitializeInstructionData {
    pub seed: u64,
    pub fee: u16,
    pub mint_x: Address,
    pub mint_y: Address,
    pub config_bump: [u8; 1],
    pub lp_bump: [u8; 1],
    pub authority: Address,
}

impl<'a> TryFrom<&'a [u8]> for InitializeInstructionData {
    type Error = ProgramError;

    fn try_from(data: &'a [u8]) -> Result<Self, Self::Error> {
        if data.len() < 76 {
            return Err(ProgramError::InvalidInstructionData);
        }

        let seed = u64::from_le_bytes(data[0..8].try_into().unwrap());
        let fee = u16::from_le_bytes(data[8..10].try_into().unwrap());
        let mint_x = Address::new_from_array(data[10..42].try_into().unwrap());
        let mint_y = Address::new_from_array(data[42..74].try_into().unwrap());
        let config_bump = [data[74]];
        let lp_bump = [data[75]];
        let authority = if data.len() >= 108 {
            Address::new_from_array(data[76..108].try_into().unwrap())
        } else {
            Address::new_from_array([0u8; 32])
        };

        if fee >= 10_000 {
            return Err(ProgramError::InvalidInstructionData);
        }

        Ok(Self {
            seed,
            fee,
            mint_x,
            mint_y,
            config_bump,
            lp_bump,
            authority,
        })
    }
}

pub struct Initialize<'a> {
    pub accounts: InitializeAccounts<'a>,
    pub instruction_data: InitializeInstructionData,
    pub program_id: &'a Address,
}

impl<'a> TryFrom<(&'a [u8], &'a [AccountView], &'a Address)> for Initialize<'a> {
    type Error = ProgramError;

    fn try_from((data, accounts, program_id): (&'a [u8], &'a [AccountView], &'a Address)) -> Result<Self, Self::Error> {
        let accounts = InitializeAccounts::try_from(accounts)?;
        let instruction_data = InitializeInstructionData::try_from(data)?;

        Ok(Self {
            accounts,
            instruction_data,
            program_id,
        })
    }
}

impl<'a> Initialize<'a> {
    pub const DISCRIMINATOR: u8 = 0;

    pub fn process(&mut self) -> ProgramResult {
        let seed_bytes = self.instruction_data.seed.to_le_bytes();
        let config_seeds = [
            Seed::from(CONFIG_SEED),
            Seed::from(&seed_bytes[..]),
            Seed::from(self.instruction_data.mint_x.as_ref()),
            Seed::from(self.instruction_data.mint_y.as_ref()),
            Seed::from(&self.instruction_data.config_bump[..]),
        ];
        let config_signer = Signer::from(&config_seeds);

        // 1. Create config PDA
        create_account_with_minimum_balance_signed(
            self.accounts.config,
            Config::LEN,
            self.program_id,
            self.accounts.initializer,
            None,
            &[config_signer],
        )?;

        // 2. Initialize config state
        {
            let mut config_data = self.accounts.config.try_borrow_mut()?;
            let config = Config::load_mut(&mut *config_data)?;
            config.set_inner(
                self.instruction_data.seed,
                self.instruction_data.authority.clone(),
                self.instruction_data.mint_x.clone(),
                self.instruction_data.mint_y.clone(),
                self.instruction_data.fee,
                self.instruction_data.config_bump,
            )?;
        }

        // 3. Create LP mint PDA (seeds: mint_lp, config, lp_bump)
        let lp_mint_seeds = [
            Seed::from(LP_MINT_SEED),
            Seed::from(self.accounts.config.address().as_ref()),
            Seed::from(&self.instruction_data.lp_bump[..]),
        ];
        let lp_mint_signer = Signer::from(&lp_mint_seeds);

        create_account_with_minimum_balance_signed(
            self.accounts.mint_lp,
            SPL_MINT_SIZE,
            &pinocchio_token::ID,
            self.accounts.initializer,
            None,
            &[lp_mint_signer],
        )?;

        // 4. Initialize LP mint
        InitializeMint2 {
            mint: self.accounts.mint_lp,
            decimals: LP_DECIMALS,
            mint_authority: self.accounts.config.address(),
            freeze_authority: None,
        }
        .invoke()?;

        Ok(())
    }
}

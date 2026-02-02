use core::ops::Deref;

use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    AccountView, ProgramResult,
};
use pinocchio_token::instructions::Transfer;

use crate::curve::{self, CurveError};
use crate::instructions::helpers::get_token_account_amount;
use crate::state::{AmmState, Config};
use crate::ID;

const CONFIG_SEED: &[u8] = b"config";

/// Blueshift 测试: 7 个账户 - user, user_x, user_y, vault_x, vault_y, config, token_program
pub struct SwapAccounts<'a> {
    pub user: &'a AccountView,
    pub user_x: &'a AccountView,
    pub user_y: &'a AccountView,
    pub vault_x: &'a AccountView,
    pub vault_y: &'a AccountView,
    pub config: &'a AccountView,
    pub token_program: &'a AccountView,
}

impl<'a> TryFrom<&'a [AccountView]> for SwapAccounts<'a> {
    type Error = ProgramError;

    fn try_from(accounts: &'a [AccountView]) -> Result<Self, Self::Error> {
        let [user, user_x, user_y, vault_x, vault_y, config, token_program] = accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        if !user.is_signer() {
            return Err(ProgramError::MissingRequiredSignature);
        }

        Ok(Self {
            user,
            user_x,
            user_y,
            vault_x,
            vault_y,
            config,
            token_program,
        })
    }
}

/// Instruction data: is_x(1) + amount(8) + min(8) + expiration(8) = 25 bytes
pub struct SwapInstructionData {
    pub is_x: bool,
    pub amount: u64,
    pub min: u64,
    pub expiration: i64,
}

impl<'a> TryFrom<&'a [u8]> for SwapInstructionData {
    type Error = ProgramError;

    fn try_from(data: &'a [u8]) -> Result<Self, Self::Error> {
        if data.len() < 25 {
            return Err(ProgramError::InvalidInstructionData);
        }

        let is_x = data[0] != 0;
        let amount = u64::from_le_bytes(data[1..9].try_into().unwrap());
        let min = u64::from_le_bytes(data[9..17].try_into().unwrap());
        let expiration = i64::from_le_bytes(data[17..25].try_into().unwrap());

        if amount == 0 || min == 0 {
            return Err(ProgramError::InvalidInstructionData);
        }

        Ok(Self {
            is_x,
            amount,
            min,
            expiration,
        })
    }
}

pub struct Swap<'a> {
    pub accounts: SwapAccounts<'a>,
    pub instruction_data: SwapInstructionData,
}

impl<'a> TryFrom<(&'a [u8], &'a [AccountView])> for Swap<'a> {
    type Error = ProgramError;

    fn try_from((data, accounts): (&'a [u8], &'a [AccountView])) -> Result<Self, Self::Error> {
        let accounts = SwapAccounts::try_from(accounts)?;
        let instruction_data = SwapInstructionData::try_from(data)?;

        let config_data = accounts.config.try_borrow()?;
        let config = Config::load(config_data.deref())?;

        if config.state() != AmmState::Initialized as u8 {
            return Err(ProgramError::InvalidAccountData);
        }

        Ok(Self {
            accounts,
            instruction_data,
        })
    }
}

fn map_curve_error(e: CurveError) -> ProgramError {
    match e {
        CurveError::Overflow => ProgramError::InvalidInstructionData,
        CurveError::Underflow => ProgramError::InvalidInstructionData,
        CurveError::ZeroBalance => ProgramError::InvalidAccountData,
        CurveError::SlippageExceeded => ProgramError::Custom(1),
    }
}

impl<'a> Swap<'a> {
    pub const DISCRIMINATOR: u8 = 3;

    pub fn process(&mut self) -> ProgramResult {
        let config_data = self.accounts.config.try_borrow()?;
        let config = Config::load(config_data.deref())?;

        let x = get_token_account_amount(self.accounts.vault_x)?;
        let y = get_token_account_amount(self.accounts.vault_y)?;
        let fee = config.fee();

        let (deposit_amount, withdraw_amount) = if self.instruction_data.is_x {
            let withdraw = curve::delta_y_from_x_swap(
                x,
                y,
                self.instruction_data.amount,
                fee,
            )
            .map_err(map_curve_error)?;
            (self.instruction_data.amount, withdraw)
        } else {
            let withdraw = curve::delta_x_from_y_swap(
                x,
                y,
                self.instruction_data.amount,
                fee,
            )
            .map_err(map_curve_error)?;
            (self.instruction_data.amount, withdraw)
        };

        if withdraw_amount < self.instruction_data.min {
            return Err(ProgramError::Custom(1));
        }

        if deposit_amount == 0 || withdraw_amount == 0 {
            return Err(ProgramError::InvalidArgument);
        }

        let seed_bytes = config.seed().to_le_bytes();
        let config_bump = config.config_bump();
        let config_seeds = [
            Seed::from(CONFIG_SEED),
            Seed::from(&seed_bytes[..]),
            Seed::from(config.mint_x().as_ref()),
            Seed::from(config.mint_y().as_ref()),
            Seed::from(&config_bump[..]),
        ];
        let signers = [Signer::from(&config_seeds)];

        if self.instruction_data.is_x {
            Transfer {
                amount: deposit_amount,
                authority: self.accounts.user,
                from: self.accounts.user_x,
                to: self.accounts.vault_x,
            }
            .invoke()?;

            Transfer {
                amount: withdraw_amount,
                authority: self.accounts.config,
                from: self.accounts.vault_y,
                to: self.accounts.user_y,
            }
            .invoke_signed(&signers)?;
        } else {
            Transfer {
                amount: deposit_amount,
                authority: self.accounts.user,
                from: self.accounts.user_y,
                to: self.accounts.vault_y,
            }
            .invoke()?;

            Transfer {
                amount: withdraw_amount,
                authority: self.accounts.config,
                from: self.accounts.vault_x,
                to: self.accounts.user_x,
            }
            .invoke_signed(&signers)?;
        }

        Ok(())
    }
}

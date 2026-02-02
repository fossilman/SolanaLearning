use core::ops::Deref;

use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    AccountView, ProgramResult,
};
use pinocchio_token::instructions::{MintTo, Transfer};

use crate::curve::{self, CurveError};
use crate::instructions::helpers::{get_mint_supply, get_token_account_amount};
use crate::state::{AmmState, Config};
use crate::ID;

const CONFIG_SEED: &[u8] = b"config";

/// Blueshift 测试: 9 个账户 - user, mint_lp, vault_x, vault_y, user_x_ata, user_y_ata, user_lp_ata, config, token_program
pub struct DepositAccounts<'a> {
    pub user: &'a AccountView,
    pub mint_lp: &'a AccountView,
    pub vault_x: &'a AccountView,
    pub vault_y: &'a AccountView,
    pub user_x_ata: &'a AccountView,
    pub user_y_ata: &'a AccountView,
    pub user_lp_ata: &'a AccountView,
    pub config: &'a AccountView,
    pub token_program: &'a AccountView,
}

impl<'a> TryFrom<&'a [AccountView]> for DepositAccounts<'a> {
    type Error = ProgramError;

    fn try_from(accounts: &'a [AccountView]) -> Result<Self, Self::Error> {
        let [
            user,
            mint_lp,
            vault_x,
            vault_y,
            user_x_ata,
            user_y_ata,
            user_lp_ata,
            config,
            token_program,
        ] = accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        if !user.is_signer() {
            return Err(ProgramError::MissingRequiredSignature);
        }

        Ok(Self {
            user,
            mint_lp,
            vault_x,
            vault_y,
            user_x_ata,
            user_y_ata,
            user_lp_ata,
            config,
            token_program,
        })
    }
}

/// Instruction data: amount(8) + max_x(8) + max_y(8) + expiration(8) = 32 bytes
pub struct DepositInstructionData {
    pub amount: u64,
    pub max_x: u64,
    pub max_y: u64,
    pub expiration: i64,
}

impl<'a> TryFrom<&'a [u8]> for DepositInstructionData {
    type Error = ProgramError;

    fn try_from(data: &'a [u8]) -> Result<Self, Self::Error> {
        if data.len() < 32 {
            return Err(ProgramError::InvalidInstructionData);
        }

        let amount = u64::from_le_bytes(data[0..8].try_into().unwrap());
        let max_x = u64::from_le_bytes(data[8..16].try_into().unwrap());
        let max_y = u64::from_le_bytes(data[16..24].try_into().unwrap());
        let expiration = i64::from_le_bytes(data[24..32].try_into().unwrap());

        if amount == 0 || max_x == 0 || max_y == 0 {
            return Err(ProgramError::InvalidInstructionData);
        }

        Ok(Self {
            amount,
            max_x,
            max_y,
            expiration,
        })
    }
}

pub struct Deposit<'a> {
    pub accounts: DepositAccounts<'a>,
    pub instruction_data: DepositInstructionData,
}

impl<'a> TryFrom<(&'a [u8], &'a [AccountView])> for Deposit<'a> {
    type Error = ProgramError;

    fn try_from((data, accounts): (&'a [u8], &'a [AccountView])) -> Result<Self, Self::Error> {
        let accounts = DepositAccounts::try_from(accounts)?;
        let instruction_data = DepositInstructionData::try_from(data)?;

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

impl<'a> Deposit<'a> {
    pub const DISCRIMINATOR: u8 = 1;

    pub fn process(&mut self) -> ProgramResult {
        let config_data = self.accounts.config.try_borrow()?;
        let config = Config::load(config_data.deref())?;

        let x = get_token_account_amount(self.accounts.vault_x)?;
        let y = get_token_account_amount(self.accounts.vault_y)?;
        let l = get_mint_supply(self.accounts.mint_lp)?;

        let (deposit_x, deposit_y) = if l == 0 && x == 0 && y == 0 {
            let lp = curve::lp_tokens_for_initial_deposit(
                self.instruction_data.max_x,
                self.instruction_data.max_y,
            )
            .map_err(map_curve_error)?;
            if self.instruction_data.amount != lp {
                return Err(ProgramError::InvalidInstructionData);
            }
            (self.instruction_data.max_x, self.instruction_data.max_y)
        } else {
            let (dx, dy) = curve::xy_deposit_amounts(
                x,
                y,
                l,
                self.instruction_data.amount,
            )
            .map_err(map_curve_error)?;
            if dx > self.instruction_data.max_x || dy > self.instruction_data.max_y {
                return Err(ProgramError::InvalidArgument);
            }
            (dx, dy)
        };

        if deposit_x > self.instruction_data.max_x || deposit_y > self.instruction_data.max_y {
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

        Transfer {
            from: self.accounts.user_x_ata,
            to: self.accounts.vault_x,
            authority: self.accounts.user,
            amount: deposit_x,
        }
        .invoke()?;

        Transfer {
            from: self.accounts.user_y_ata,
            to: self.accounts.vault_y,
            authority: self.accounts.user,
            amount: deposit_y,
        }
        .invoke()?;

        MintTo {
            mint: self.accounts.mint_lp,
            account: self.accounts.user_lp_ata,
            mint_authority: self.accounts.config,
            amount: self.instruction_data.amount,
        }
        .invoke_signed(&signers)?;

        Ok(())
    }
}

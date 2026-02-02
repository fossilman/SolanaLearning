use core::ops::Deref;

use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    AccountView, ProgramResult,
};
use pinocchio_token::instructions::{Burn, Transfer};

use crate::curve::{self, CurveError};
use crate::instructions::helpers::{get_mint_supply, get_token_account_amount};
use crate::state::{AmmState, Config};
use crate::ID;

const CONFIG_SEED: &[u8] = b"config";

/// Blueshift 测试: 9 个账户 - user, mint_lp, vault_x, vault_y, user_x_ata, user_y_ata, user_lp_ata, config, token_program
pub struct WithdrawAccounts<'a> {
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

impl<'a> TryFrom<&'a [AccountView]> for WithdrawAccounts<'a> {
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

/// Instruction data: amount(8) + min_x(8) + min_y(8) + expiration(8) = 32 bytes
pub struct WithdrawInstructionData {
    pub amount: u64,
    pub min_x: u64,
    pub min_y: u64,
    pub expiration: i64,
}

impl<'a> TryFrom<&'a [u8]> for WithdrawInstructionData {
    type Error = ProgramError;

    fn try_from(data: &'a [u8]) -> Result<Self, Self::Error> {
        if data.len() < 32 {
            return Err(ProgramError::InvalidInstructionData);
        }

        let amount = u64::from_le_bytes(data[0..8].try_into().unwrap());
        let min_x = u64::from_le_bytes(data[8..16].try_into().unwrap());
        let min_y = u64::from_le_bytes(data[16..24].try_into().unwrap());
        let expiration = i64::from_le_bytes(data[24..32].try_into().unwrap());

        if amount == 0 || min_x == 0 || min_y == 0 {
            return Err(ProgramError::InvalidInstructionData);
        }

        Ok(Self {
            amount,
            min_x,
            min_y,
            expiration,
        })
    }
}

pub struct Withdraw<'a> {
    pub accounts: WithdrawAccounts<'a>,
    pub instruction_data: WithdrawInstructionData,
}

impl<'a> TryFrom<(&'a [u8], &'a [AccountView])> for Withdraw<'a> {
    type Error = ProgramError;

    fn try_from((data, accounts): (&'a [u8], &'a [AccountView])) -> Result<Self, Self::Error> {
        let accounts = WithdrawAccounts::try_from(accounts)?;
        let instruction_data = WithdrawInstructionData::try_from(data)?;

        let config_data = accounts.config.try_borrow()?;
        let config = Config::load(config_data.deref())?;

        if config.state() == AmmState::Disabled as u8 {
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

impl<'a> Withdraw<'a> {
    pub const DISCRIMINATOR: u8 = 2;

    pub fn process(&mut self) -> ProgramResult {
        let config_data = self.accounts.config.try_borrow()?;
        let config = Config::load(config_data.deref())?;

        let x = get_token_account_amount(self.accounts.vault_x)?;
        let y = get_token_account_amount(self.accounts.vault_y)?;
        let l = get_mint_supply(self.accounts.mint_lp)?;

        let (withdraw_x, withdraw_y) = if l == self.instruction_data.amount {
            (x, y)
        } else {
            let (wx, wy) = curve::xy_withdraw_amounts(
                x,
                y,
                l,
                self.instruction_data.amount,
            )
            .map_err(map_curve_error)?;
            if wx < self.instruction_data.min_x || wy < self.instruction_data.min_y {
                return Err(ProgramError::InvalidArgument);
            }
            (wx, wy)
        };

        if withdraw_x < self.instruction_data.min_x || withdraw_y < self.instruction_data.min_y {
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
            amount: withdraw_x,
            authority: self.accounts.config,
            from: self.accounts.vault_x,
            to: self.accounts.user_x_ata,
        }
        .invoke_signed(&signers)?;

        Transfer {
            amount: withdraw_y,
            authority: self.accounts.config,
            from: self.accounts.vault_y,
            to: self.accounts.user_y_ata,
        }
        .invoke_signed(&signers)?;

        Burn {
            account: self.accounts.user_lp_ata,
            mint: self.accounts.mint_lp,
            authority: self.accounts.user,
            amount: self.instruction_data.amount,
        }
        .invoke()?;

        Ok(())
    }
}

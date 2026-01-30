use core::mem::size_of;

use pinocchio::{
    account::Ref,
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{
        clock::Clock,
        instructions::{Instructions, IntrospectedInstruction},
        Sysvar,
    },
    AccountView, Address, ProgramResult,
};
use pinocchio_secp256r1_instruction::Secp256r1Instruction;
use pinocchio_system::instructions::Transfer;

/// Secp256r1 压缩公钥：1 字节奇偶性 + 32 字节 x 坐标
pub type Secp256r1Pubkey = [u8; 33];

// ========== Deposit ==========

pub struct DepositAccounts<'a> {
    pub payer: &'a AccountView,
    pub vault: &'a AccountView,
}

impl<'a> TryFrom<&'a [AccountView]> for DepositAccounts<'a> {
    type Error = ProgramError;

    fn try_from(accounts: &'a [AccountView]) -> Result<Self, Self::Error> {
        let [payer, vault, _] = accounts else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        if !payer.is_signer() {
            return Err(ProgramError::InvalidAccountOwner);
        }

        if !vault.owned_by(&pinocchio_system::ID) {
            return Err(ProgramError::InvalidAccountOwner);
        }

        if vault.lamports() != 0 {
            return Err(ProgramError::InvalidAccountData);
        }

        Ok(Self { payer, vault })
    }
}

#[repr(C, packed)]
pub struct DepositInstructionData {
    pub pubkey: Secp256r1Pubkey,
    pub amount: u64,
}

impl<'a> TryFrom<&'a [u8]> for DepositInstructionData {
    type Error = ProgramError;

    fn try_from(data: &'a [u8]) -> Result<Self, Self::Error> {
        if data.len() != size_of::<Self>() {
            return Err(ProgramError::InvalidInstructionData);
        }

        let (pubkey_bytes, amount_bytes) = data.split_at(size_of::<Secp256r1Pubkey>());

        Ok(Self {
            pubkey: pubkey_bytes.try_into().unwrap(),
            amount: u64::from_le_bytes(amount_bytes.try_into().unwrap()),
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

        Ok(Self {
            accounts,
            instruction_data,
        })
    }
}

impl<'a> Deposit<'a> {
    pub const DISCRIMINATOR: u8 = 0;

    pub fn process(&mut self) -> ProgramResult {
        let (vault_key, _) = Address::find_program_address(
            &[
                b"vault".as_slice(),
                &self.instruction_data.pubkey[..1],
                &self.instruction_data.pubkey[1..33],
            ],
            &crate::ID,
        );
        if self.accounts.vault.address() != &vault_key {
            return Err(ProgramError::InvalidAccountOwner);
        }

        Transfer {
            from: self.accounts.payer,
            to: self.accounts.vault,
            lamports: self.instruction_data.amount,
        }
        .invoke()?;

        Ok(())
    }
}

// ========== Withdraw ==========

pub struct WithdrawAccounts<'a> {
    pub payer: &'a AccountView,
    pub vault: &'a AccountView,
    pub instructions: &'a AccountView,
}

impl<'a> TryFrom<&'a [AccountView]> for WithdrawAccounts<'a> {
    type Error = ProgramError;

    fn try_from(accounts: &'a [AccountView]) -> Result<Self, Self::Error> {
        let [payer, vault, instructions, _system_program] = accounts else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        if !payer.is_signer() {
            return Err(ProgramError::InvalidAccountOwner);
        }

        if !vault.owned_by(&pinocchio_system::ID) {
            return Err(ProgramError::InvalidAccountOwner);
        }

        if vault.lamports() == 0 {
            return Err(ProgramError::InvalidAccountData);
        }

        Ok(Self {
            payer,
            vault,
            instructions,
        })
    }
}

pub struct WithdrawInstructionData {
    pub bump: [u8; 1],
}

impl<'a> TryFrom<&'a [u8]> for WithdrawInstructionData {
    type Error = ProgramError;

    fn try_from(data: &'a [u8]) -> Result<Self, Self::Error> {
        Ok(Self {
            bump: [*data
                .first()
                .ok_or(ProgramError::InvalidInstructionData)?],
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

        Ok(Self {
            accounts,
            instruction_data,
        })
    }
}

impl<'a> Withdraw<'a> {
    pub const DISCRIMINATOR: u8 = 1;

    pub fn process(&mut self) -> ProgramResult {
        let instructions: Instructions<Ref<[u8]>> =
            Instructions::try_from(self.accounts.instructions)?;
        let ix: IntrospectedInstruction = instructions.get_instruction_relative(1)?;
        let ix_data = ix.get_instruction_data();
        let secp256r1_ix = Secp256r1Instruction::try_from(ix_data)
            .map_err(|_| ProgramError::InvalidInstructionData)?;

        if secp256r1_ix.num_signatures() != 1 {
            return Err(ProgramError::InvalidInstructionData);
        }

        let signer: Secp256r1Pubkey = *secp256r1_ix
            .get_signer(0)
            .map_err(|_| ProgramError::InvalidInstructionData)?;

        let msg = secp256r1_ix
            .get_message_data(0)
            .map_err(|_| ProgramError::InvalidInstructionData)?;
        if msg.len() < 32 + 8 {
            return Err(ProgramError::InvalidInstructionData);
        }
        let (payer_bytes, expiry_bytes) = msg.split_at(32);
        let payer_address = Address::new_from_array(
            payer_bytes
                .try_into()
                .map_err(|_| ProgramError::InvalidInstructionData)?,
        );
        if self.accounts.payer.address() != &payer_address {
            return Err(ProgramError::InvalidAccountOwner);
        }

        let expiry = i64::from_le_bytes(
            expiry_bytes[..8]
                .try_into()
                .map_err(|_| ProgramError::InvalidInstructionData)?,
        );
        let now = Clock::get()?.unix_timestamp;
        if now > expiry {
            return Err(ProgramError::InvalidInstructionData);
        }

        let seeds = [
            Seed::from(b"vault".as_slice()),
            Seed::from(signer[..1].as_ref()),
            Seed::from(signer[1..].as_ref()),
            Seed::from(self.instruction_data.bump.as_slice()),
        ];
        let signers = [Signer::from(&seeds)];

        Transfer {
            from: self.accounts.vault,
            to: self.accounts.payer,
            lamports: self.accounts.vault.lamports(),
        }
        .invoke_signed(&signers)?;

        Ok(())
    }
}

use pinocchio::error::ProgramError;

#[repr(u32)]
pub enum EscrowError {
    InvalidAmount = 6000,
    InvalidMaker = 6001,
    InvalidMintA = 6002,
    InvalidMintB = 6003,
}

impl From<EscrowError> for ProgramError {
    fn from(e: EscrowError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

use pinocchio::{AccountView, Address};
use pinocchio_associated_token_account::ID as ATA_ID;
use pinocchio_token::ID as TOKEN_ID;

/// Get the associated token address for a wallet and mint
pub fn get_associated_token_address(wallet: &Address, mint: &Address) -> Address {
    let (address, _) = Address::find_program_address(
        &[wallet.as_ref(), TOKEN_ID.as_ref(), mint.as_ref()],
        &ATA_ID,
    );
    address
}

/// SPL Token account layout: amount at offset 64
const TOKEN_ACCOUNT_AMOUNT_OFFSET: usize = 64;

/// Read token account amount from AccountView (SPL Token layout)
pub fn get_token_account_amount(
    account: &AccountView,
) -> Result<u64, pinocchio::error::ProgramError> {
    let data = account.try_borrow()?;
    if data.len() < TOKEN_ACCOUNT_AMOUNT_OFFSET + 8 {
        return Err(pinocchio::error::ProgramError::InvalidAccountData);
    }
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&data[TOKEN_ACCOUNT_AMOUNT_OFFSET..TOKEN_ACCOUNT_AMOUNT_OFFSET + 8]);
    Ok(u64::from_le_bytes(bytes))
}

/// SPL Mint layout: decimals at offset 44
const MINT_DECIMALS_OFFSET: usize = 44;

/// Read mint decimals from AccountView (SPL Token layout)
pub fn get_mint_decimals(account: &AccountView) -> Result<u8, pinocchio::error::ProgramError> {
    let data = account.try_borrow()?;
    if data.len() < MINT_DECIMALS_OFFSET + 1 {
        return Err(pinocchio::error::ProgramError::InvalidAccountData);
    }
    Ok(data[MINT_DECIMALS_OFFSET])
}

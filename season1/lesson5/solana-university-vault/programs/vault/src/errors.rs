use anchor_lang::error_code;

#[error_code]
pub enum VaultError {
    #[msg("存款金额必须大于 0")]
    InvalidDepositAmount,
    
    #[msg("余额不足")]
    InsufficientBalance,
    
    #[msg("数值溢出")]
    Overflow,
}


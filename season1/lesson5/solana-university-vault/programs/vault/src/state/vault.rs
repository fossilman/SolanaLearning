use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Vault {
    /// 金库所有者
    pub authority: Pubkey,
    /// 总存款金额 (逻辑记账)
    pub total_deposits: u64,
    /// 创建时间戳
    pub created_at: i64,
    /// PDA bump (存储它以节省后续计算)
    pub bump: u8,
    /// 紧急暂停状态
    pub is_paused: bool,
}

impl Vault {
    pub const SEED_PREFIX: &'static [u8] = b"vault";
}
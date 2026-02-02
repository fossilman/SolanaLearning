<ArticleSection name="模板" id="template" level="h2" />
这次我们将把程序分成小而集中的模块，而不是将所有内容都塞进 lib.rs 中。文件夹结构大致如下：

```text
src
├── instructions
│       ├── make.rs
│       ├── helpers.rs
│       ├── mod.rs
│       ├── refund.rs
│       └── take.rs
├── errors.rs
├── lib.rs
└── state.rs
```

入口点位于 lib.rs 中，与我们在上一课中所做的非常相似，因此我们会快速浏览：

```rust
use pinocchio::{account_info::AccountInfo, entrypoint, program_error::ProgramError, pubkey::Pubkey, ProgramResult};
entrypoint!(process_instruction);

pub mod instructions;
pub use instructions::*;

pub mod state;
pub use state::*;

// 22222222222222222222222222222222222222222222
pub const ID: Pubkey = [
    0x0f, 0x1e, 0x6b, 0x14, 0x21, 0xc0, 0x4a, 0x07,
    0x04, 0x31, 0x26, 0x5c, 0x19, 0xc5, 0xbb, 0xee,
    0x19, 0x92, 0xba, 0xe8, 0xaf, 0xd1, 0xcd, 0x07,
    0x8e, 0xf8, 0xaf, 0x70, 0x47, 0xdc, 0x11, 0xf7,
];

fn process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    match instruction_data.split_first() {
        Some((Make::DISCRIMINATOR, data)) => Make::try_from((data, accounts))?.process(),
        Some((Take::DISCRIMINATOR, _)) => Take::try_from(accounts)?.process(),
        Some((Refund::DISCRIMINATOR, _)) => Refund::try_from(accounts)?.process(),
        _ => Err(ProgramError::InvalidInstructionData)
    }
}
```

<ArticleSection name="State" id="template" level="h2" />

我们将进入 state.rs，其中存储了我们 Escrow 的所有数据。我们将其分为两部分：结构体定义及其实现。

首先，让我们看看结构体定义：

```rust
use pinocchio::{program_error::ProgramError, pubkey::Pubkey};
use core::mem::size_of;

#[repr(C)]
pub struct Escrow {
    pub seed: u64,        // Random seed for PDA derivation
    pub maker: Pubkey,    // Creator of the escrow
    pub mint_a: Pubkey,   // Token being deposited
    pub mint_b: Pubkey,   // Token being requested
    pub receive: u64,     // Amount of token B wanted
    pub bump: [u8;1]      // PDA bump seed
}
```
#[repr(C)] 属性确保我们的结构体具有可预测的内存布局，这对于链上数据至关重要。每个字段都有特定的用途：
    + seed：一个随机数，允许一个创建者使用相同的代币对创建多个托管
    + maker：创建托管并将接收代币的钱包地址
    + mint_a：存入代币的 SPL 代币铸造地址
    + mint_b：请求代币的 SPL 代币铸造地址
    + receive：创建者希望接收的代币 B 的确切数量
    + bump：在 PDA 推导中使用的单字节，用于确保地址不在 Ed25519 曲线上
现在，让我们看看包含所有辅助方法的实现：
```rust
impl Escrow {
    pub const LEN: usize = size_of::<u64>() 
    + size_of::<Pubkey>() 
    + size_of::<Pubkey>() 
    + size_of::<Pubkey>() 
    + size_of::<u64>()
    + size_of::<[u8;1]>();

    #[inline(always)]
    pub fn load_mut(bytes: &mut [u8]) -> Result<&mut Self, ProgramError> {
        if bytes.len() != Escrow::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(unsafe { &mut *core::mem::transmute::<*mut u8, *mut Self>(bytes.as_mut_ptr()) })
    }

    #[inline(always)]
    pub fn load(bytes: &[u8]) -> Result<&Self, ProgramError> {
        if bytes.len() != Escrow::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(unsafe { &*core::mem::transmute::<*const u8, *const Self>(bytes.as_ptr()) })
    }

    #[inline(always)]
    pub fn set_seed(&mut self, seed: u64) {
        self.seed = seed;
    }

    #[inline(always)]
    pub fn set_maker(&mut self, maker: Pubkey) {
        self.maker = maker;
    }

    #[inline(always)]
    pub fn set_mint_a(&mut self, mint_a: Pubkey) {
        self.mint_a = mint_a;
    }

    #[inline(always)]
    pub fn set_mint_b(&mut self, mint_b: Pubkey) {
        self.mint_b = mint_b;
    }

    #[inline(always)]
    pub fn set_receive(&mut self, receive: u64) {
        self.receive = receive;
    }

    #[inline(always)]
    pub fn set_bump(&mut self, bump: [u8;1]) {
        self.bump = bump;
    }

    #[inline(always)]
    pub fn set_inner(&mut self, seed: u64, maker: Pubkey, mint_a: Pubkey, mint_b: Pubkey, receive: u64, bump: [u8;1]) {
        self.seed = seed;
        self.maker = maker;
        self.mint_a = mint_a;
        self.mint_b = mint_b;
        self.receive = receive;
        self.bump = bump;
    }
}
```
该实现提供了几个关键功能：

1.精确的大小计算：LEN 通过汇总每个字段的大小，精确计算账户大小
2.安全加载：load 提供了一种安全的方式来加载和验证托管数据
3.性能优化：
    + 在 getter 上使用 #[inline(always)] 以实现最大性能
    + 当我们确定借用是安全时，使用不安全方法
    + 使用 set_inner 高效地设置字段
4.内存安全：对账户数据长度和所有权进行适当验证
5.文档：清晰的注释，解释每个方法的目的和安全注意事项

此实现确保我们的托管状态既安全又高效，在适当的地方进行了适当的验证和性能优化。

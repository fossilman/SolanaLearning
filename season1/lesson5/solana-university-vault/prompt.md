### PART1
solana-university-vault/
├── Anchor.toml
├── Cargo.toml
├── programs/
│   └── vault/
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs              # 程序入口
│           ├── instructions/       # 指令逻辑拆分
│           │   ├── mod.rs
│           │   ├── initialize.rs   # 初始化指令
│           │   ├── deposit.rs      # 存款指令
│           │   └── withdraw.rs     # 提款指令
│           ├── state/              # 账户结构定义
│           │   ├── mod.rs
│           │   └── vault.rs
│           └── errors.rs           # 自定义错误码
└── tests/
    └── vault.ts                    # TypeScript 集成测试
根据该项目结构创建文件，文件内容为空

## PART2
已更新 vault.ts，添加了 TogglePause 的测试用例。新增的测试包括：
初始化时金库未暂停 - 验证初始化后 isPaused 为 false
所有者可以切换暂停状态 - 验证可以暂停和恢复，状态正确切换
非所有者无法切换暂停状态 - 验证非所有者调用会失败
暂停状态下不能存款 - 验证暂停时存款会抛出 VaultPaused 错误
暂停状态下不能提款 - 验证暂停时提款会抛出 VaultPaused 错误
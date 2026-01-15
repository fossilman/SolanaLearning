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
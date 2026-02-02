# Pinocchio AMM — LiteSVM 可测试点与测试方法

本文档基于 `pinocchio_amm` 项目代码分析，说明使用 **LiteSVM** 工具可覆盖的测试点及推荐测试方法。LiteSVM 在进程内运行 Solana VM，无需外部 validator，适合对指令级逻辑、账户状态和曲线数学进行快速回归测试。

---

## 一、项目概览与入口

- **程序 ID**：`lib.rs` 中 `ID`（固定 32 字节）
- **指令分发**：`instruction_data[0]` 为 discriminator，随后为各指令数据
  - `0` → Initialize
  - `1` → Deposit
  - `2` → Withdraw
  - `3` → Swap
- **依赖**：`pinocchio-system`（创建账户）、`pinocchio-token`（SPL Token）、PDA 推导

---

## 二、LiteSVM 可测试点

### 1. Initialize（初始化 AMM）

| 测试点 | 说明 | 预期/断言 |
|--------|------|------------|
| **1.1 成功初始化** | 正确 PDA、种子、fee、mint_x/y、bump，5 个账户且 initializer 为 signer | Config 账户创建且 `state == Initialized(1)`；LP mint 创建且 decimals=6，mint_authority=config PDA |
| **1.2 账户数量不足** | 传入少于 5 个账户 | 返回 `NotEnoughAccountKeys` |
| **1.3 缺少签名** | initializer 非 signer | 返回 `MissingRequiredSignature` |
| **1.4 fee 非法** | instruction data 中 fee >= 10000 (bps) | 返回 `InvalidInstructionData` |
| **1.5 指令数据过短** | data 长度 < 76 字节 | 返回 `InvalidInstructionData` |
| **1.6 Config PDA 推导** | 使用 seeds `["config", seed_le, mint_x, mint_y, config_bump]` | Config 地址与程序内推导一致，且创建成功 |
| **1.7 LP Mint PDA 推导** | 使用 seeds `["mint_lp", config_address, lp_bump]` | LP mint 由 Token Program 创建，mint_authority 为 config PDA |

**LiteSVM 测试思路**：  
构建 LiteSVM 环境，部署 `pinocchio_amm`（cdylib）；创建 initializer、mint_x、mint_y（或使用占位/预创建 mint）；用正确 seeds 计算 config 与 mint_lp PDA；构造 Initialize 指令（discriminator 0 + 76~108 字节数据）；提交交易后读取 config 账户解析 `Config` 与 LP mint 的 supply/decimals/authority，做断言。

---

### 2. Deposit（添加流动性）

| 测试点 | 说明 | 预期/断言 |
|--------|------|------------|
| **2.1 首次存款（池子为空）** | vault_x/y 余额为 0，LP supply 为 0；amount = lp_tokens = max(x,y)，max_x/max_y 与转入一致 | 用户 x/y 减少 max_x、max_y；vault_x/y 增加等量；user_lp_ata 增加 amount；LP supply = amount；曲线：`lp_tokens_for_initial_deposit(max_x, max_y) == amount` |
| **2.2 后续存款** | 池子已有 x,y,l；按 `xy_deposit_amounts(x,y,l, amount)` 计算应有 deposit_x, deposit_y | 用户转入 deposit_x/deposit_y；vault 增加；铸造 amount 的 LP 给用户；若 deposit_x > max_x 或 deposit_y > max_y 则 `InvalidArgument` |
| **2.3 amount 与首次 LP 不匹配** | 首次存款时 amount != max(x,y) | 返回 `InvalidInstructionData` |
| **2.4 滑点保护** | 后续存款时计算出的 deposit_x > max_x 或 deposit_y > max_y | 返回 `InvalidArgument` |
| **2.5 AMM 未初始化** | config.state != Initialized | 返回 `InvalidAccountData` |
| **2.6 账户数量/签名** | 账户数 != 9 或 user 非 signer | `NotEnoughAccountKeys` / `MissingRequiredSignature` |
| **2.7 非法指令数据** | amount/max_x/max_y 任一为 0 或 data.len() < 32 | `InvalidInstructionData` |

**LiteSVM 测试思路**：  
先通过 Initialize 建池；为 user 创建 mint_x/mint_y 的 ATA 并 mint 足够代币；vault_x/vault_y 为 config 下 ATA（或 PDA 控制的 token account）。首次存款：构造 [discriminator=1, amount(8), max_x(8), max_y(8), expiration(8)]，amount = max(max_x, max_y)；执行后断言 vault、user 余额与 LP supply。后续存款：先做一笔首次存款，再改 amount/max_x/max_y 做第二笔，用 `curve::xy_deposit_amounts` 预计算期望值并断言。

---

### 3. Withdraw（移除流动性）

| 测试点 | 说明 | 预期/断言 |
|--------|------|------------|
| **3.1 部分赎回** | 池子 x,y,l；withdraw amount < l；用 `xy_withdraw_amounts(x,y,l, amount)` 得 withdraw_x, withdraw_y | 用户 LP 减少 amount；vault 转出 withdraw_x/withdraw_y 到 user；min_x/min_y 作为下限，若实际低于则 `InvalidArgument` |
| **3.2 全部赎回** | amount == l（全部 LP） | 取回全部 vault 的 x 和 y；LP 全部 burn |
| **3.3 滑点保护** | 计算得到的 withdraw_x < min_x 或 withdraw_y < min_y | 返回 `InvalidArgument` |
| **3.4 amount > l** | 赎回量大于当前 LP supply | 曲线返回错误，映射为 `InvalidInstructionData` / `InvalidAccountData` |
| **3.5 AMM 已禁用** | config.state == Disabled | 返回 `InvalidAccountData`（WithdrawOnly 仍应允许） |
| **3.6 账户/签名/数据** | 账户数、signer、amount/min_x/min_y 为 0 等 | 与 Deposit 类似的错误码 |

**LiteSVM 测试思路**：  
在 Deposit 测试基础上，先 deposit 再 withdraw。构造 [discriminator=2, amount(8), min_x(8), min_y(8), expiration(8)]；用 `curve::xy_withdraw_amounts` 算期望的 withdraw_x/withdraw_y，设 min_x/min_y 略低于期望以通过滑点检查；执行后断言 user x/y 增加、vault 减少、LP burn。

---

### 4. Swap（兑换）

| 测试点 | 说明 | 预期/断言 |
|--------|------|------------|
| **4.1 X → Y（is_x=true）** | 用户用 amount 的 X 换 Y；`delta_y_from_x_swap(x, y, amount, fee_bps)` 得 out_y | 用户 X 减少 amount，Y 增加 out_y（扣费后）；vault_x 增、vault_y 减；fee 从 amount 中扣 (10000-fee_bps)/10000 |
| **4.2 Y → X（is_x=false）** | 用户用 amount 的 Y 换 X；`delta_x_from_y_swap(x, y, amount, fee_bps)` 得 out_x | 用户 Y 减少 amount，X 增加 out_x；vault_y 增、vault_x 减 |
| **4.3 滑点保护** | 实际得到的 out 小于 instruction 中的 min | 返回 `Custom(1)`（SlippageExceeded） |
| **4.4 池子空** | x==0 或 y==0 | 曲线 ZeroBalance → `InvalidAccountData` |
| **4.5 AMM 非 Initialized** | config.state != Initialized | `InvalidAccountData` |
| **4.6 账户数/签名** | 7 个账户、user 为 signer | 否则 `NotEnoughAccountKeys` / `MissingRequiredSignature` |
| **4.7 指令数据** | is_x(1) + amount(8) + min(8) + expiration(8)，至少 25 字节；amount/min 非 0 | 否则 `InvalidInstructionData` |

**LiteSVM 测试思路**：  
Initialize + 至少一笔 Deposit 后，给 user 足够的 X 或 Y；构造 [discriminator=3, is_x(1), amount(8), min(8), expiration(8)]；用 `curve::delta_y_from_x_swap` 或 `delta_x_from_y_swap` 预计算期望输出，min 设为略低于该值；执行后断言 user 与 vault 的 x/y 变化量，以及 fee 比例（config.fee() 从 config 账户读取）。

---

### 5. 曲线与状态（间接通过指令测）

| 测试点 | 说明 | 测试方式 |
|--------|------|----------|
| **5.1 常数乘积 k** | Swap 后 (vault_x + Δx)(vault_y + Δy) 与 fee 处理后的 k 一致 | 在 Swap 测试中记录前后 vault 余额，用曲线公式与 fee 反推验证 |
| **5.2 Config 状态** | AmmState::Uninitialized/Initialized/Disabled/WithdrawOnly | Initialize 后读 config；若有“禁用”指令可再测 Withdraw 在 Disabled 下失败、WithdrawOnly 下仅允许 Withdraw |
| **5.3 fee 边界** | fee 0 与 9999 bps 时 Swap 输出与公式一致 | 两轮 Initialize（不同 fee）或单池多 Swap，对比 out 与 curve 返回值 |

---

## 三、LiteSVM 测试方法建议

### 3.1 环境与依赖

- 在 `Cargo.toml` 的 `[dev-dependencies]` 增加：`litesvm`、`litesvm-token`（或 `litesvm-utils`），按官方示例引入。
- 编译：`cargo build --release`，将生成的 `libpinocchio_amm.so`（或当前平台的 cdylib）路径交给 LiteSVM 加载。

### 3.2 账户准备（通用）

- **System**：initializer（signer）、可选 payer。
- **Token**：mint_x、mint_y（可由 LiteSVM/Token Program 创建并 mint）；LP mint 由 Initialize 创建。
- **PDA**：  
  - config: `[b"config", seed_le_8, mint_x, mint_y, config_bump]`，program_id = pinocchio_amm ID。  
  - mint_lp: `[b"mint_lp", config_pubkey, lp_bump]`，program_id = **Token Program**（Initialize 里用 `pinocchio_token::ID`）。
- **ATA**：user 的 mint_x、mint_y、LP 的 ATA；vault_x、vault_y 为“config 的 ATA”（mint_x/mint_y），需在 Deposit 前存在且由 config 拥有。

### 3.3 指令数据布局（便于写测试）

- **Initialize**：`[0, seed(8), fee(2), mint_x(32), mint_y(32), config_bump(1), lp_bump(1), authority(32)?]`，至少 76 字节，authority 可选到 108 字节。
- **Deposit**：`[1, amount(8), max_x(8), max_y(8), expiration(8)]`，32 字节。
- **Withdraw**：`[2, amount(8), min_x(8), min_y(8), expiration(8)]`，32 字节。
- **Swap**：`[3, is_x(1), amount(8), min(8), expiration(8)]`，25 字节。

### 3.4 单测结构建议

1. **test_initialize_ok**：仅执行 Initialize，断言 config 存在且 state=1，LP mint 存在且 supply=0、decimals=6。  
2. **test_deposit_initial**：Initialize + 一笔首次 Deposit，断言 vault、user 余额与 LP supply。  
3. **test_deposit_second**：在上一步后再 Deposit，用 `xy_deposit_amounts` 算期望，断言余额与 supply。  
4. **test_withdraw_partial**：Deposit 后 Withdraw 部分 LP，用 `xy_withdraw_amounts` 断言。  
5. **test_swap_x_for_y / test_swap_y_for_x**：Deposit 后执行 Swap，用 `delta_y_from_x_swap` / `delta_x_from_y_swap` 断言 out 与余额变化。  
6. **test_initialize_fail_* / test_deposit_fail_* 等**：错误路径：错误账户数、非 signer、错误 data、错误 state、滑点等，断言返回错误类型。

### 3.5 断言要点

- **账户存在性**：config、mint_lp、vault_x、vault_y 等。  
- **Config 解析**：按 `state.rs` 的 `Config` 布局读 state、seed、authority、mint_x、mint_y、fee、config_bump。  
- **Token 余额**：SPL Token 账户 amount 在 offset 64，mint supply 在 offset 36；用 helpers 或同等逻辑解析。  
- **错误码**：LiteSVM 返回的 instruction error 或 transaction error 与 ProgramError 对应（如 InvalidInstructionData、InvalidArgument、Custom(1)）。

---

## 四、与 Mollusk / Surfpool 的差异（便于选型）

- **LiteSVM**：内嵌完整 VM、真实交易执行、适合“从交易到账户变化”的端到端测试；需正确构造 PDAs 与 SPL 账户。  
- **Mollusk**：多用于指令级单元测试，直接传 `AccountView` 与 data，不跑完整 VM。  
- **Surfpool**：另一类测试/仿真环境，侧重点可能不同。

对 pinocchio_amm，LiteSVM 最适合覆盖：Initialize 创建 PDA 与 mint、Deposit/Withdraw 的 Token 转移与 LP 铸造/销毁、Swap 的 X/Y 转移与手续费，以及上述所有错误路径；曲线数学可通过预计算 + 余额断言间接验证。

---

## 五、LiteSVM 测试常见失败与结论

### 5.1 PrivilegeEscalation（CPI 时 signer 权限提升）

- **现象**：`test_initialize_ok` / `test_deposit_initial` 报错：`X's signer privilege escalated`、`Cross-program invocation with unauthorized signer or writable account`。
- **原因**：程序在 CPI 调用 System/Token 时，把「payer/initializer」当作 signer 传入；若交易里该账户在 Message 中被去重不当（例如 payer 与指令第一个账户被当成两个不同 key），则运行时认为该账户在交易层不是 signer，从而报 PrivilegeEscalation。
- **测试侧已做**：  
  - 使用**同一变量**作为 payer 与指令第一个账户（例如 `let payer = initializer.pubkey();`，Instruction 第一个 `AccountMeta` 与 `Transaction::new_signed_with_payer(..., Some(&payer), ...)` 都用 `payer`），保证 Message 编译时去重为同一账户并保留 signer。  
  - 若仍失败，可能与 LiteSVM/BPF 运行时对 Legacy 交易或账户列表的处理有关，可再尝试用 `VersionedTransaction` + `VersionedMessage::Legacy` 构建交易，或查阅 LiteSVM 文档/issue。

### 5.2 "Provided seeds do not result in a valid address"

- **现象**：Initialize 执行到创建 config PDA 或 LP mint PDA 时失败：`Could not create program address with signer seeds: Provided seeds do not result in a valid address`。
- **可能原因**：  
  - 测试中 PDA 推导用的 `program_id`（如 `amm_program_id()`）与运行时传给程序的 `program_id` 不一致（例如程序用 `cargo build --release` 生成、未用与 `AMM_PROGRAM_ID_BYTES` 一致的 ID 部署）。  
  - 程序二进制与测试使用的 program ID 不一致（如 build-sbf 的 DeclareId / keypair 与测试常量不同）。
- **建议**：  
  - 使用 `cargo build-sbf` 构建部署用 .so，并确保部署用的 program ID 与 `lib.rs` 中 `ID` / 测试中 `AMM_PROGRAM_ID_BYTES` 一致。  
  - 确认 `svm.add_program_from_file(SolanaAddress::from(AMM_PROGRAM_ID_BYTES), program_path)` 与指令里的 `program_id: amm_program_id()` 一致。

### 5.3 小结

- 测试代码已统一「payer = 指令第一个账户」的变量，以减少 PrivilegeEscalation。  
- 若仍出现上述两类错误，优先核对：program ID 一致性、BPF 程序构建方式、以及 LiteSVM 文档中关于 CPI/签名/账户列表的说明。

---

## 六、小结表

| 指令 | 建议必测点 | LiteSVM 重点 |
|------|------------|--------------|
| Initialize | 成功路径 + 账户/签名/fee/data 错误 | Config/LP mint PDA 创建与 state |
| Deposit | 首次/后续存款、滑点、state、data | vault/user 余额与 LP supply |
| Withdraw | 部分/全部赎回、滑点、state、data | vault/user 与 LP burn |
| Swap | X→Y、Y→X、滑点、空池、state、data | 余额变化与 fee、k 不变（可选） |

按上述点编写 LiteSVM 用例，即可系统覆盖本 AMM 的指令逻辑与曲线行为，并保持测试稳定、可重复。

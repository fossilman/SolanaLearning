import { Keypair, Connection } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";

// 默认Solana配置目录
const SOLANA_CONFIG_DIR = path.join(os.homedir(), ".config", "solana");
const DEFAULT_KEYPAIR_FILE = path.join(SOLANA_CONFIG_DIR, "id.json");
const WALLET_DIR = SOLANA_CONFIG_DIR;
const CLI_CONFIG_FILE = path.join(SOLANA_CONFIG_DIR, "cli", "config.yml");

// 预定义的网络配置
const NETWORKS = {
  "mainnet-beta": {
    name: "Mainnet Beta",
    url: "https://api.mainnet-beta.solana.com",
    wsUrl: "wss://api.mainnet-beta.solana.com",
  },
  "devnet": {
    name: "Devnet",
    url: "https://api.devnet.solana.com",
    wsUrl: "wss://api.devnet.solana.com",
  },
  "testnet": {
    name: "Testnet",
    url: "https://api.testnet.solana.com",
    wsUrl: "wss://api.testnet.solana.com",
  },
  "localhost": {
    name: "Localhost",
    url: "http://127.0.0.1:8899",
    wsUrl: "ws://127.0.0.1:8900",
  },
};

// 确保目录存在
if (!fs.existsSync(SOLANA_CONFIG_DIR)) {
  fs.mkdirSync(SOLANA_CONFIG_DIR, { recursive: true });
}

// 创建readline接口
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// 工具函数：询问用户输入
function question(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

// 工具函数：加载密钥对
function loadKeypair(filePath) {
  try {
    const keypairData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Keypair.fromSecretKey(new Uint8Array(keypairData));
  } catch (error) {
    throw new Error(`无法加载密钥对: ${error.message}`);
  }
}

// 工具函数：保存密钥对
function saveKeypair(keypair, filename) {
  const filePath = path.join(WALLET_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(Array.from(keypair.secretKey)));
  return filePath;
}

// 获取所有钱包文件列表
function getAllWalletFiles() {
  if (!fs.existsSync(WALLET_DIR)) {
    return [];
  }
  
  const files = fs.readdirSync(WALLET_DIR);
  return files
    .filter((file) => file.endsWith(".json"))
    .map((file) => ({
      filename: file,
      filepath: path.join(WALLET_DIR, file),
      isDefault: file === "id.json",
    }));
}

// 工具函数：显示钱包信息
function displayWalletInfo(keypair, filename) {
  const publicKey = keypair.publicKey.toString();
  const secretKey = keypair.secretKey;
  
  console.log("\n" + "=".repeat(60));
  console.log(`钱包文件: ${filename}`);
  console.log(`公钥地址: ${publicKey}`);
  console.log(`私钥长度: ${secretKey.length} bytes`);
  console.log("=".repeat(60) + "\n");
}

// 工具函数：读取 YAML 配置文件
function readConfigYaml() {
  try {
    if (!fs.existsSync(CLI_CONFIG_FILE)) {
      return {};
    }
    
    const content = fs.readFileSync(CLI_CONFIG_FILE, "utf-8");
    const config = {};
    
    // 简单的 YAML 解析（只处理基本的 key: value 格式）
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const colonIndex = trimmed.indexOf(":");
        if (colonIndex > 0) {
          const key = trimmed.substring(0, colonIndex).trim();
          const value = trimmed.substring(colonIndex + 1).trim();
          // 移除可能的引号
          config[key] = value.replace(/^["']|["']$/g, "");
        }
      }
    }
    
    return config;
  } catch (error) {
    return {};
  }
}

// 工具函数：写入 YAML 配置文件
function writeConfigYaml(config) {
  try {
    // 确保目录存在
    const configDir = path.dirname(CLI_CONFIG_FILE);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    
    // 简单的 YAML 写入
    const lines = [];
    for (const [key, value] of Object.entries(config)) {
      lines.push(`${key}: ${value}`);
    }
    
    fs.writeFileSync(CLI_CONFIG_FILE, lines.join("\n") + "\n", "utf-8");
    return true;
  } catch (error) {
    throw new Error(`写入配置文件失败: ${error.message}`);
  }
}

// 工具函数：获取当前网络配置
function getCurrentNetwork() {
  try {
    const config = readConfigYaml();
    const jsonRpcUrl = config.json_rpc_url || "";
    
    // 查找匹配的预定义网络
    for (const [key, network] of Object.entries(NETWORKS)) {
      if (jsonRpcUrl === network.url) {
        return {
          key,
          ...network,
          custom: false,
        };
      }
    }
    
    // 如果是自定义 URL
    if (jsonRpcUrl) {
      return {
        key: "custom",
        name: "Custom Network",
        url: jsonRpcUrl,
        wsUrl: config.websocket_url || "",
        custom: true,
      };
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

// 工具函数：根据 URL 识别网络名称
function identifyNetworkFromUrl(url) {
  for (const [key, network] of Object.entries(NETWORKS)) {
    if (url === network.url || url.includes(network.url.replace("https://", "").replace("http://", ""))) {
      return network.name;
    }
  }
  return "Custom Network";
}

// 功能4: 创建钱包账户
async function createWallet() {
  try {
    const name = await question("请输入钱包名称（留空自动生成）: ");
    const filename = name.trim() 
      ? `${name.trim().replace(/\.json$/, "")}.json` 
      : `wallet_${Date.now()}.json`;
    
    // 检查文件是否已存在
    const filePath = path.join(WALLET_DIR, filename);
    if (fs.existsSync(filePath)) {
      const overwrite = await question(`钱包文件 ${filename} 已存在，是否覆盖？(y/N): `);
      if (overwrite.toLowerCase() !== "y") {
        console.log("❌ 创建已取消");
        return;
      }
    }
    
    // 生成新密钥对
    console.log("\n正在生成密钥对...");
    const keypair = Keypair.generate();
    saveKeypair(keypair, filename);
    
    console.log(`\n✅ 钱包创建成功！`);
    displayWalletInfo(keypair, filename);
  } catch (error) {
    console.log(`❌ 创建钱包失败: ${error.message}`);
  }
}

// 功能6: 批量创建钱包账户
async function batchCreateWallets() {
  try {
    const countInput = await question("请输入要创建的钱包数量 (1-100): ");
    const count = parseInt(countInput.trim(), 10);
    
    if (isNaN(count) || count <= 0) {
      console.log("❌ 请输入有效的数字！");
      return;
    }
    
    if (count > 100) {
      console.log("❌ 批量创建数量不能超过100个！");
      return;
    }
    
    const prefix = await question("请输入钱包名称前缀（回车使用 'wallet'）: ");
    const walletPrefix = prefix.trim() || "wallet";
    
    const skipExisting = await question("是否跳过已存在的钱包？(Y/n): ");
    const shouldSkip = skipExisting.trim().toLowerCase() !== "n";
    
    console.log(`\n开始批量创建 ${count} 个钱包...`);
    if (shouldSkip) {
      console.log("(将跳过已存在的钱包)\n");
    } else {
      console.log("(将覆盖已存在的钱包)\n");
    }
    
    const createdWallets = [];
    const skippedWallets = [];
    const overwrittenWallets = [];
    
    for (let i = 1; i <= count; i++) {
      const filename = `${walletPrefix}_${i}.json`;
      const filePath = path.join(WALLET_DIR, filename);
      
      if (fs.existsSync(filePath)) {
        if (shouldSkip) {
          skippedWallets.push(filename);
          console.log(`⚠️  [${i}/${count}] 跳过已存在的钱包: ${filename}`);
          continue;
        } else {
          overwrittenWallets.push(filename);
        }
      }
      
      const keypair = Keypair.generate();
      saveKeypair(keypair, filename);
      createdWallets.push({ filename, publicKey: keypair.publicKey.toString() });
      console.log(`✅ [${i}/${count}] ${filename.padEnd(30)} ${keypair.publicKey.toString()}`);
    }
    
    console.log(`\n${"=".repeat(70)}`);
    console.log(`✅ 批量创建完成！`);
    console.log(`   成功创建: ${createdWallets.length} 个`);
    if (skippedWallets.length > 0) {
      console.log(`   跳过: ${skippedWallets.length} 个`);
    }
    if (overwrittenWallets.length > 0) {
      console.log(`   覆盖: ${overwrittenWallets.length} 个`);
    }
    console.log(`${"=".repeat(70)}`);
  } catch (error) {
    console.log(`❌ 批量创建失败: ${error.message}`);
  }
}

// 功能5: 导入钱包账户
async function importWallet() {
  try {
    console.log(`\n提示: 默认导入路径为 ${DEFAULT_KEYPAIR_FILE}`);
    const sourcePath = await question("请输入要导入的钱包文件路径（回车使用默认路径）: ");
    
    const filePath = sourcePath.trim() || DEFAULT_KEYPAIR_FILE;
    
    if (!fs.existsSync(filePath)) {
      console.log(`❌ 文件不存在: ${filePath}`);
      return;
    }
    
    // 加载密钥对
    console.log("\n正在加载钱包文件...");
    const keypair = loadKeypair(filePath);
    
    // 询问保存名称
    const name = await question("请输入保存的钱包名称（回车使用原文件名）: ");
    let filename;
    
    if (name.trim()) {
      filename = name.trim().replace(/\.json$/, "") + ".json";
    } else {
      filename = path.basename(filePath);
    }
    
    // 如果导入的是默认文件且文件名相同，不需要重新保存
    if (filePath === DEFAULT_KEYPAIR_FILE && filename === "id.json") {
      console.log(`\n✅ 默认钱包已存在: ${filePath}`);
      displayWalletInfo(keypair, filename);
      return;
    }
    
    // 检查目标文件是否已存在
    const targetPath = path.join(WALLET_DIR, filename);
    if (fs.existsSync(targetPath) && targetPath !== filePath) {
      const overwrite = await question(
        `文件 ${filename} 已存在，是否覆盖？(y/N): `
      );
      if (overwrite.toLowerCase() !== "y") {
        console.log("❌ 导入已取消");
        return;
      }
    }
    
    // 保存密钥对
    if (targetPath !== filePath) {
      saveKeypair(keypair, filename);
      console.log(`\n✅ 钱包导入成功！`);
    } else {
      console.log(`\n✅ 钱包已存在！`);
    }
    
    displayWalletInfo(keypair, filename);
  } catch (error) {
    console.log(`❌ 导入钱包失败: ${error.message}`);
  }
}

// 功能2: 查看钱包账户详细信息
async function viewWalletDetails() {
  try {
    const wallets = getAllWalletFiles();
    
    if (wallets.length === 0) {
      console.log("\n❌ 没有找到任何钱包文件！");
      console.log("   提示: 请先创建或导入钱包");
      return;
    }
    
    console.log("\n" + "=".repeat(70));
    console.log("可用的钱包列表:");
    console.log("-".repeat(70));
    wallets.forEach((wallet, index) => {
      try {
        const keypair = loadKeypair(wallet.filepath);
        const marker = wallet.isDefault ? " ⭐默认" : "";
        const shortKey = keypair.publicKey.toString();
        console.log(`  ${index + 1}. ${wallet.filename.padEnd(30)} ${shortKey.substring(0, 12)}...${shortKey.substring(shortKey.length - 8)}${marker}`);
      } catch (error) {
        console.log(`  ${index + 1}. ${wallet.filename.padEnd(30)} ❌ 加载失败`);
      }
    });
    console.log("=".repeat(70));
    
    const input = await question("\n请选择要查看的钱包编号（回车查看默认钱包，输入 q 返回）: ");
    const trimmedInput = input.trim();
    
    if (trimmedInput.toLowerCase() === "q" || trimmedInput.toLowerCase() === "quit") {
      return;
    }
    
    let selectedWallet;
    
    // 如果直接回车，查看默认钱包
    if (trimmedInput === "") {
      selectedWallet = wallets.find((w) => w.isDefault);
      if (!selectedWallet) {
        console.log("❌ 未设置默认钱包，请选择具体的钱包编号");
        return;
      }
    } else {
      const num = parseInt(trimmedInput, 10);
      
      if (!isNaN(num) && num >= 1 && num <= wallets.length) {
        selectedWallet = wallets[num - 1];
      } else {
        const filename = trimmedInput.endsWith(".json") 
          ? trimmedInput 
          : `${trimmedInput}.json`;
        selectedWallet = wallets.find((w) => w.filename === filename);
        
        if (!selectedWallet) {
          const filePath = path.join(WALLET_DIR, filename);
          if (fs.existsSync(filePath)) {
            selectedWallet = { filename, filepath: filePath };
          }
        }
      }
    }
    
    if (!selectedWallet) {
      console.log("❌ 未找到指定的钱包！");
      return;
    }
    
    const keypair = loadKeypair(selectedWallet.filepath);
    displayWalletInfo(keypair, selectedWallet.filename);
  } catch (error) {
    console.log(`❌ 查看钱包信息失败: ${error.message}`);
  }
}

// 功能1: 查看所有钱包账户地址
function viewAllWalletAddresses() {
  try {
    const wallets = getAllWalletFiles();
    
    if (wallets.length === 0) {
      console.log("\n❌ 没有找到任何钱包文件！");
      console.log("   提示: 请先创建或导入钱包");
      return;
    }
    
    console.log("\n" + "=".repeat(90));
    console.log(`所有钱包账户地址 (共 ${wallets.length} 个):`);
    console.log("=".repeat(90));
    console.log(`${"序号".padEnd(6)} ${"文件名".padEnd(32)} ${"公钥地址".padEnd(44)} 状态`);
    console.log("-".repeat(90));
    
    wallets.forEach((wallet, index) => {
      try {
        const keypair = loadKeypair(wallet.filepath);
        const marker = wallet.isDefault ? "⭐ 默认" : "";
        const publicKey = keypair.publicKey.toString();
        console.log(
          `${(index + 1).toString().padStart(4)}  ${wallet.filename.padEnd(30)} ${publicKey.padEnd(44)} ${marker}`
        );
      } catch (error) {
        console.log(
          `${(index + 1).toString().padStart(4)}  ${wallet.filename.padEnd(30)} ${"❌ 加载失败".padEnd(44)} ${error.message}`
        );
      }
    });
    
    console.log("=".repeat(90));
  } catch (error) {
    console.log(`❌ 查看钱包地址失败: ${error.message}`);
  }
}

// 功能3: 切换钱包账号（设置默认钱包）
async function switchWallet() {
  try {
    const wallets = getAllWalletFiles();
    
    if (wallets.length === 0) {
      console.log("\n❌ 没有找到任何钱包文件！");
      console.log("   提示: 请先创建或导入钱包");
      return;
    }
    
    console.log("\n" + "=".repeat(70));
    console.log("可用的钱包列表:");
    console.log("-".repeat(70));
    wallets.forEach((wallet, index) => {
      try {
        const keypair = loadKeypair(wallet.filepath);
        const marker = wallet.isDefault ? " ⭐当前默认" : "";
        const shortKey = keypair.publicKey.toString();
        console.log(`  ${index + 1}. ${wallet.filename.padEnd(30)} ${shortKey.substring(0, 12)}...${shortKey.substring(shortKey.length - 8)}${marker}`);
      } catch (error) {
        console.log(`  ${index + 1}. ${wallet.filename.padEnd(30)} ❌ 加载失败${wallet.isDefault ? " ⭐当前默认" : ""}`);
      }
    });
    console.log("=".repeat(70));
    
    const input = await question("\n请选择要设置为默认的钱包编号（输入 q 取消）: ");
    const trimmedInput = input.trim();
    
    if (trimmedInput.toLowerCase() === "q" || trimmedInput.toLowerCase() === "quit") {
      console.log("❌ 操作已取消");
      return;
    }
    
    let selectedWallet;
    const num = parseInt(trimmedInput, 10);
    
    if (!isNaN(num) && num >= 1 && num <= wallets.length) {
      selectedWallet = wallets[num - 1];
    } else {
      const filename = trimmedInput.endsWith(".json") 
        ? trimmedInput 
        : `${trimmedInput}.json`;
      selectedWallet = wallets.find((w) => w.filename === filename);
      
      if (!selectedWallet) {
        const filePath = path.join(WALLET_DIR, filename);
        if (fs.existsSync(filePath)) {
          selectedWallet = { filename, filepath: filePath };
        }
      }
    }
    
    if (!selectedWallet) {
      console.log("❌ 未找到指定的钱包！");
      return;
    }
    
    if (selectedWallet.isDefault) {
      console.log("✅ 该钱包已经是默认钱包！");
      return;
    }
    
    // 备份当前默认钱包（如果存在）
    const defaultKeypairPath = path.join(WALLET_DIR, "id.json");
    if (fs.existsSync(defaultKeypairPath)) {
      const backupName = `id_backup_${Date.now()}.json`;
      fs.copyFileSync(defaultKeypairPath, path.join(WALLET_DIR, backupName));
      console.log(`\nℹ️  已备份当前默认钱包为: ${backupName}`);
    }
    
    // 复制选中的钱包为默认钱包
    fs.copyFileSync(selectedWallet.filepath, defaultKeypairPath);
    
    const keypair = loadKeypair(defaultKeypairPath);
    console.log(`✅ 已切换默认钱包为: ${selectedWallet.filename}`);
    console.log(`   公钥地址: ${keypair.publicKey.toString()}`);
  } catch (error) {
    console.log(`❌ 切换钱包失败: ${error.message}`);
  }
}

// 获取当前默认钱包信息
function getDefaultWalletInfo() {
  try {
    if (fs.existsSync(DEFAULT_KEYPAIR_FILE)) {
      const keypair = loadKeypair(DEFAULT_KEYPAIR_FILE);
      return {
        exists: true,
        publicKey: keypair.publicKey.toString(),
      };
    }
  } catch (error) {
    // 忽略错误
  }
  return { exists: false, publicKey: null };
}

// 功能：显示当前网络
function viewCurrentNetwork() {
  try {
    const network = getCurrentNetwork();
    const config = readConfigYaml();
    
    console.log("\n" + "=".repeat(70));
    console.log("当前网络配置:");
    console.log("-".repeat(70));
    
    if (network) {
      console.log(`网络名称: ${network.name}`);
      console.log(`RPC URL:  ${network.url}`);
      if (network.wsUrl) {
        console.log(`WebSocket: ${network.wsUrl}`);
      }
      if (network.custom) {
        console.log(`⚠️  这是自定义网络配置`);
      }
    } else {
      console.log("⚠️  未检测到网络配置");
      console.log(`配置文件: ${CLI_CONFIG_FILE}`);
    }
    
    if (config.keypair_path) {
      console.log(`密钥文件: ${config.keypair_path}`);
    }
    if (config.commitment) {
      console.log(`承诺级别: ${config.commitment}`);
    }
    
    console.log("=".repeat(70));
  } catch (error) {
    console.log(`❌ 获取网络配置失败: ${error.message}`);
  }
}

// 功能：切换网络
async function switchNetwork() {
  try {
    const currentNetwork = getCurrentNetwork();
    
    console.log("\n" + "=".repeat(70));
    console.log("可用的网络列表:");
    console.log("-".repeat(70));
    
    let index = 1;
    const networkList = [];
    
    for (const [key, network] of Object.entries(NETWORKS)) {
      const isCurrent = currentNetwork && currentNetwork.key === key;
      const marker = isCurrent ? " ⭐当前" : "";
      console.log(`  ${index}. ${network.name.padEnd(15)} ${network.url}${marker}`);
      networkList.push({ key, ...network });
      index++;
    }
    
    console.log(`  ${index}. 自定义网络 (手动输入 URL)`);
    console.log("=".repeat(70));
    
    const input = await question("\n请选择要切换的网络编号（输入 q 取消）: ");
    const trimmedInput = input.trim();
    
    if (trimmedInput.toLowerCase() === "q" || trimmedInput.toLowerCase() === "quit") {
      console.log("❌ 操作已取消");
      return;
    }
    
    const selectedIndex = parseInt(trimmedInput, 10);
    let selectedNetwork;
    
    if (!isNaN(selectedIndex) && selectedIndex >= 1 && selectedIndex <= networkList.length + 1) {
      if (selectedIndex === networkList.length + 1) {
        // 自定义网络
        const customUrl = await question("请输入 RPC URL: ");
        const trimmedUrl = customUrl.trim();
        
        if (!trimmedUrl) {
          console.log("❌ URL 不能为空");
          return;
        }
        
        // 验证 URL 格式
        try {
          new URL(trimmedUrl);
        } catch (error) {
          console.log("❌ 无效的 URL 格式");
          return;
        }
        
        selectedNetwork = {
          key: "custom",
          name: "Custom Network",
          url: trimmedUrl,
          wsUrl: trimmedUrl.replace("https://", "wss://").replace("http://", "ws://"),
          custom: true,
        };
      } else {
        selectedNetwork = networkList[selectedIndex - 1];
      }
    } else {
      console.log("❌ 无效的选择");
      return;
    }
    
    // 检查是否已经是当前网络
    if (currentNetwork && currentNetwork.url === selectedNetwork.url) {
      console.log("✅ 该网络已经是当前网络！");
      return;
    }
    
    // 更新配置
    const config = readConfigYaml();
    config.json_rpc_url = selectedNetwork.url;
    config.websocket_url = selectedNetwork.wsUrl;
    
    // 保留其他配置
    if (!config.keypair_path) {
      config.keypair_path = DEFAULT_KEYPAIR_FILE;
    }
    if (!config.commitment) {
      config.commitment = "confirmed";
    }
    
    writeConfigYaml(config);
    
    console.log(`\n✅ 已切换到网络: ${selectedNetwork.name}`);
    console.log(`   RPC URL: ${selectedNetwork.url}`);
    
    // 测试连接（可选）
    const testConnection = await question("\n是否测试网络连接？(Y/n): ");
    if (testConnection.trim().toLowerCase() !== "n") {
      console.log("\n正在测试连接...");
      try {
        const connection = new Connection(selectedNetwork.url, "confirmed");
        // 设置超时
        const timeout = new Promise((_, reject) => 
          setTimeout(() => reject(new Error("连接超时")), 5000)
        );
        const versionPromise = connection.getVersion();
        const version = await Promise.race([versionPromise, timeout]);
        console.log(`✅ 连接成功！`);
        console.log(`   Solana 版本: ${version["solana-core"]}`);
      } catch (error) {
        console.log(`⚠️  连接测试失败: ${error.message}`);
        console.log(`   请检查网络 URL 是否正确，或稍后手动测试`);
      }
    }
  } catch (error) {
    console.log(`❌ 切换网络失败: ${error.message}`);
  }
}

// 显示主菜单
function showMenu() {
  const wallets = getAllWalletFiles();
  const walletCount = wallets.length;
  const defaultWallet = getDefaultWalletInfo();
  const currentNetwork = getCurrentNetwork();
  
  console.log("\n" + "=".repeat(70));
  console.log("                    Solana 钱包管理工具");
  console.log("=".repeat(70));
  
  // 显示统计信息
  console.log(`📊 钱包总数: ${walletCount}`);
  if (defaultWallet.exists) {
    console.log(`⭐ 默认钱包: ${defaultWallet.publicKey.substring(0, 8)}...${defaultWallet.publicKey.substring(defaultWallet.publicKey.length - 8)}`);
  } else {
    console.log(`⚠️  默认钱包: 未设置`);
  }
  
  if (currentNetwork) {
    console.log(`🌐 当前网络: ${currentNetwork.name}`);
    const urlShort = currentNetwork.url.length > 45 
      ? currentNetwork.url.substring(0, 42) + "..."
      : currentNetwork.url;
    console.log(`   ${urlShort}`);
  } else {
    console.log(`⚠️  当前网络: 未配置`);
  }
  
  console.log("-".repeat(70));
  
  // 调整后的菜单顺序：常用操作在前
  console.log("1. 📋 查看所有钱包账户地址");
  console.log("2. 🔍 查看钱包账户详细信息");
  console.log("3. 🔄 切换钱包账号（设置默认钱包）");
  console.log("4. ➕ 创建钱包账户");
  console.log("5. 📥 导入钱包账户");
  console.log("6. 📦 批量创建钱包账户");
  console.log("7. 🌐 显示当前网络配置");
  console.log("8. 🔄 切换网络");
  console.log("0. ❌ 退出");
  
  console.log("=".repeat(70));
}

// 工具函数：等待用户按键
async function waitForEnter(message = "") {
  if (message === "") {
    message = "\n按 Enter 键返回主菜单...";
  }
  await question(message);
}

// 主函数
async function main() {
  console.log("\n🚀 Solana 钱包管理工具启动");
  console.log(`📁 钱包目录: ${WALLET_DIR}\n`);
  
  while (true) {
    showMenu();
    const choice = await question("\n请选择操作 (0-8): ");
    
    switch (choice.trim()) {
      case "1":
        viewAllWalletAddresses();
        await waitForEnter();
        break;
      case "2":
        await viewWalletDetails();
        await waitForEnter();
        break;
      case "3":
        await switchWallet();
        await waitForEnter();
        break;
      case "4":
        await createWallet();
        await waitForEnter();
        break;
      case "5":
        await importWallet();
        await waitForEnter();
        break;
      case "6":
        await batchCreateWallets();
        await waitForEnter();
        break;
      case "7":
        viewCurrentNetwork();
        await waitForEnter();
        break;
      case "8":
        await switchNetwork();
        await waitForEnter();
        break;
      case "0":
      case "q":
      case "quit":
      case "exit":
        console.log("\n👋 再见！");
        rl.close();
        process.exit(0);
        break;
      default:
        console.log("❌ 无效的选择，请输入 0-8 之间的数字！");
        console.log("   提示: 也可以输入 q/quit/exit 退出");
        await waitForEnter();
    }
  }
}

// 运行主函数
main().catch((error) => {
  console.error("❌ 发生错误:", error);
  rl.close();
  process.exit(1);
});

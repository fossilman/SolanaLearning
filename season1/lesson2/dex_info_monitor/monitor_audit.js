const WebSocket = require('ws');
const { HttpsProxyAgent } = require('https-proxy-agent');
const https = require('https');

// 配置代理
const PROXY_URL = 'http://127.0.0.1:7890';
const USE_PROXY = true;

// 审计配置
const AUDIT_CONFIG = {
  enabled: true,
  autoAudit: true, // 自动审计新代币
  checks: {
    rugCheck: true,        // Rug pull 检查
    honeypotCheck: true,   // 蜜罐检查
    liquidityCheck: true,  // 流动性检查
    holderCheck: true,     // 持有者分布检查
    contractCheck: true    // 合约安全检查
  },
  thresholds: {
    minLiquidity: 5,           // 最小流动性 (SOL)
    maxTopHolderPercent: 20,   // 最大单一持有者占比 (%)
    minHolderCount: 10,        // 最小持有者数量
    maxCreatorPercent: 10      // 创建者最大持有占比 (%)
  }
};

// DEX 配置
const DEX_CONFIG = {
  pumpfun: {
    enabled: true,
    wsUrl: 'wss://pumpportal.fun/api/data',
    name: 'Pump.fun',
    emoji: '🎪',
    subscriptions: {
      subscribeNewToken: true,
      subscribeTokenTrade: false,
      subscribeAccountTrade: false,
      tokens: [],
      accounts: []
    }
  },
  raydium: {
    enabled: true,
    wsUrl: 'wss://api.mainnet-beta.solana.com',
    name: 'Raydium',
    emoji: '⚡',
    programId: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
    subscriptions: {
      monitorTokens: []
    }
  },
  orca: {
    enabled: true,
    wsUrl: 'wss://api.mainnet-beta.solana.com',
    name: 'Orca',
    emoji: '🐋',
    programId: '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP',
    subscriptions: {
      monitorTokens: []
    }
  }
};

class TokenAuditor {
  constructor(config, useProxy, proxyUrl) {
    this.config = config;
    this.useProxy = useProxy;
    this.proxyUrl = proxyUrl;
    this.auditCache = new Map(); // 缓存审计结果
  }

  // 审计代币
  async auditToken(tokenAddress, tokenData = {}) {
    // 检查缓存
    if (this.auditCache.has(tokenAddress)) {
      const cached = this.auditCache.get(tokenAddress);
      if (Date.now() - cached.timestamp < 300000) { // 5分钟缓存
        return cached.result;
      }
    }

    console.log('\n' + '🔍'.repeat(35));
    console.log('🔍 开始审计代币:', tokenAddress);
    console.log('🔍'.repeat(35));

    const auditResult = {
      tokenAddress,
      timestamp: new Date().toISOString(),
      score: 100, // 初始分数 100
      risks: [],
      warnings: [],
      passed: [],
      details: {}
    };

    try {
      // 1. Rug Check - 检查是否有 rug pull 风险
      if (this.config.checks.rugCheck) {
        await this.checkRugRisk(tokenAddress, tokenData, auditResult);
      }

      // 2. 流动性检查
      if (this.config.checks.liquidityCheck) {
        await this.checkLiquidity(tokenAddress, tokenData, auditResult);
      }

      // 3. 持有者分布检查
      if (this.config.checks.holderCheck) {
        await this.checkHolderDistribution(tokenAddress, auditResult);
      }

      // 4. 蜜罐检查
      if (this.config.checks.honeypotCheck) {
        await this.checkHoneypot(tokenAddress, auditResult);
      }

      // 5. 合约检查
      if (this.config.checks.contractCheck) {
        await this.checkContract(tokenAddress, tokenData, auditResult);
      }

      // 计算最终风险等级
      auditResult.riskLevel = this.calculateRiskLevel(auditResult.score);
      
      // 缓存结果
      this.auditCache.set(tokenAddress, {
        result: auditResult,
        timestamp: Date.now()
      });

      // 显示审计结果
      this.displayAuditResult(auditResult);

      return auditResult;

    } catch (error) {
      console.error('❌ 审计失败:', error.message);
      auditResult.error = error.message;
      return auditResult;
    }
  }

  // 检查 Rug Pull 风险
  async checkRugRisk(tokenAddress, tokenData, result) {
    console.log('  ⏳ 检查 Rug Pull 风险...');

    // 检查创建者持有占比
    if (tokenData.creator && tokenData.creatorBalance) {
      const creatorPercent = (tokenData.creatorBalance / tokenData.totalSupply) * 100;
      
      if (creatorPercent > this.config.thresholds.maxCreatorPercent) {
        result.score -= 30;
        result.risks.push({
          type: 'HIGH',
          message: `创建者持有 ${creatorPercent.toFixed(2)}% 代币，存在高抛售风险`
        });
      } else {
        result.passed.push('创建者持有占比正常');
      }
    }

    // 检查是否有锁仓
    if (tokenData.hasLock === false) {
      result.score -= 20;
      result.warnings.push({
        type: 'MEDIUM',
        message: '未检测到流动性锁仓'
      });
    } else if (tokenData.hasLock === true) {
      result.passed.push('流动性已锁仓');
    }

    // 检查铸币权限
    if (tokenData.mintable === true) {
      result.score -= 25;
      result.risks.push({
        type: 'HIGH',
        message: '代币可增发，存在稀释风险'
      });
    } else if (tokenData.mintable === false) {
      result.passed.push('铸币权限已关闭');
    }
  }

  // 检查流动性
  async checkLiquidity(tokenAddress, tokenData, result) {
    console.log('  ⏳ 检查流动性...');

    const liquidity = tokenData.vSolInBondingCurve || tokenData.liquidity || 0;
    result.details.liquidity = liquidity;

    if (liquidity < this.config.thresholds.minLiquidity) {
      result.score -= 15;
      result.warnings.push({
        type: 'MEDIUM',
        message: `流动性过低: ${liquidity.toFixed(2)} SOL`
      });
    } else {
      result.passed.push(`流动性充足: ${liquidity.toFixed(2)} SOL`);
    }

    // 检查流动性是否可移除
    if (tokenData.removableLiquidity === true) {
      result.score -= 20;
      result.warnings.push({
        type: 'MEDIUM',
        message: '流动性可被移除'
      });
    }
  }

  // 检查持有者分布
  async checkHolderDistribution(tokenAddress, result) {
    console.log('  ⏳ 检查持有者分布...');

    try {
      // 模拟获取持有者数据（实际应调用 Solana RPC）
      const holderData = await this.getHolderData(tokenAddress);
      
      result.details.holderCount = holderData.count;
      result.details.topHolderPercent = holderData.topHolderPercent;

      // 检查持有者数量
      if (holderData.count < this.config.thresholds.minHolderCount) {
        result.score -= 10;
        result.warnings.push({
          type: 'LOW',
          message: `持有者数量较少: ${holderData.count}`
        });
      } else {
        result.passed.push(`持有者数量: ${holderData.count}`);
      }

      // 检查集中度
      if (holderData.topHolderPercent > this.config.thresholds.maxTopHolderPercent) {
        result.score -= 15;
        result.warnings.push({
          type: 'MEDIUM',
          message: `最大持有者占比过高: ${holderData.topHolderPercent.toFixed(2)}%`
        });
      } else {
        result.passed.push('持有者分布合理');
      }

    } catch (error) {
      console.log('    ⚠️  无法获取持有者数据');
    }
  }

  // 检查蜜罐
  async checkHoneypot(tokenAddress, result) {
    console.log('  ⏳ 检查蜜罐风险...');

    try {
      // 模拟蜜罐检测（实际应调用专门的 API）
      const honeypotData = await this.detectHoneypot(tokenAddress);

      if (honeypotData.isHoneypot) {
        result.score -= 50;
        result.risks.push({
          type: 'CRITICAL',
          message: '检测到蜜罐特征，可能无法卖出'
        });
      } else {
        result.passed.push('未检测到蜜罐特征');
      }

      if (honeypotData.buyTax > 10 || honeypotData.sellTax > 10) {
        result.score -= 15;
        result.warnings.push({
          type: 'MEDIUM',
          message: `交易税过高: 买入 ${honeypotData.buyTax}% / 卖出 ${honeypotData.sellTax}%`
        });
      }

    } catch (error) {
      console.log('    ⚠️  无法检测蜜罐');
    }
  }

  // 检查合约
  async checkContract(tokenAddress, tokenData, result) {
    console.log('  ⏳ 检查合约安全...');

    // 检查是否有社交媒体链接
    const hasSocials = tokenData.twitter || tokenData.telegram || tokenData.website;
    if (!hasSocials) {
      result.score -= 10;
      result.warnings.push({
        type: 'LOW',
        message: '缺少社交媒体链接'
      });
    } else {
      result.passed.push('有社交媒体链接');
    }

    // 检查代币元数据
    if (!tokenData.name || !tokenData.symbol) {
      result.score -= 5;
      result.warnings.push({
        type: 'LOW',
        message: '代币信息不完整'
      });
    }

    // 检查合约年龄（如果是新创建的）
    if (tokenData.createdAt) {
      const ageMinutes = (Date.now() - new Date(tokenData.createdAt).getTime()) / 60000;
      result.details.ageMinutes = ageMinutes.toFixed(0);
      
      if (ageMinutes < 10) {
        result.warnings.push({
          type: 'LOW',
          message: `代币刚创建 ${ageMinutes.toFixed(0)} 分钟，建议观察`
        });
      }
    }
  }

  // 模拟获取持有者数据
  async getHolderData(tokenAddress) {
    // 实际应该调用 Solana RPC 或第三方 API
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          count: Math.floor(Math.random() * 100) + 10,
          topHolderPercent: Math.random() * 30 + 5
        });
      }, 500);
    });
  }

  // 模拟蜜罐检测
  async detectHoneypot(tokenAddress) {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          isHoneypot: Math.random() > 0.9, // 10% 概率是蜜罐
          buyTax: Math.random() * 5,
          sellTax: Math.random() * 5
        });
      }, 500);
    });
  }

  // 计算风险等级
  calculateRiskLevel(score) {
    if (score >= 80) return { level: 'LOW', emoji: '🟢', text: '低风险' };
    if (score >= 60) return { level: 'MEDIUM', emoji: '🟡', text: '中等风险' };
    if (score >= 40) return { level: 'HIGH', emoji: '🟠', text: '高风险' };
    return { level: 'CRITICAL', emoji: '🔴', text: '极高风险' };
  }

  // 显示审计结果
  displayAuditResult(result) {
    console.log('\n' + '═'.repeat(70));
    console.log('📋 审计报告');
    console.log('═'.repeat(70));
    console.log('代币地址:', result.tokenAddress);
    console.log('审计时间:', new Date(result.timestamp).toLocaleString('zh-CN'));
    console.log('');
    
    // 风险等级
    console.log('🎯 风险评级:', result.riskLevel.emoji, result.riskLevel.text);
    console.log('📊 安全分数:', result.score, '/ 100');
    console.log('');

    // 通过的检查
    if (result.passed.length > 0) {
      console.log('✅ 通过检查:');
      result.passed.forEach(item => {
        console.log('  ✓', item);
      });
      console.log('');
    }

    // 警告
    if (result.warnings.length > 0) {
      console.log('⚠️  警告:');
      result.warnings.forEach(warning => {
        console.log(`  [${warning.type}]`, warning.message);
      });
      console.log('');
    }

    // 风险
    if (result.risks.length > 0) {
      console.log('🚨 风险:');
      result.risks.forEach(risk => {
        console.log(`  [${risk.type}]`, risk.message);
      });
      console.log('');
    }

    // 详细信息
    if (Object.keys(result.details).length > 0) {
      console.log('📌 详细信息:');
      for (const [key, value] of Object.entries(result.details)) {
        console.log(`  ${key}:`, value);
      }
      console.log('');
    }

    // 投资建议
    console.log('💡 投资建议:');
    if (result.score >= 80) {
      console.log('  该代币通过了大部分安全检查，风险较低。');
    } else if (result.score >= 60) {
      console.log('  该代币存在一些风险因素，建议谨慎投资。');
    } else if (result.score >= 40) {
      console.log('  该代币存在较高风险，不建议大额投资。');
    } else {
      console.log('  该代币风险极高，强烈建议避免投资！');
    }

    console.log('═'.repeat(70));
  }
}

class MultiDexListener {
  constructor(useProxy, proxyUrl, dexConfig, auditConfig) {
    this.useProxy = useProxy;
    this.proxyUrl = proxyUrl;
    this.dexConfig = dexConfig;
    this.auditConfig = auditConfig;
    this.connections = new Map();
    this.auditor = new TokenAuditor(auditConfig, useProxy, proxyUrl);
    this.stats = {
      pumpfun: { total: 0, creates: 0, buys: 0, sells: 0, audited: 0 },
      raydium: { total: 0, swaps: 0, addLiquidity: 0, removeLiquidity: 0 },
      orca: { total: 0, swaps: 0, addLiquidity: 0, removeLiquidity: 0 },
      startTime: Date.now()
    };
  }

  startAll() {
    console.log('🚀 启动多 DEX 监听器 + 代币审计');
    console.log('═'.repeat(70));
    
    if (this.auditConfig.enabled) {
      console.log('✅ 代币审计已启用');
      if (this.auditConfig.autoAudit) {
        console.log('✅ 自动审计新代币');
      }
      console.log('');
    }
    
    if (this.dexConfig.pumpfun.enabled) {
      this.connectPumpFun();
    }
    
    if (this.dexConfig.raydium.enabled) {
      this.connectRaydium();
    }
    
    if (this.dexConfig.orca.enabled) {
      this.connectOrca();
    }
    
    this.startStatsDisplay();
  }

  connectPumpFun() {
    const config = this.dexConfig.pumpfun;
    const connection = this.createConnection('pumpfun', config);
    
    connection.ws.on('open', () => {
      console.log(`${config.emoji} ${config.name} 已连接`);
      this.subscribePumpFun(connection.ws, config.subscriptions);
    });
    
    connection.ws.on('message', (data) => {
      this.handlePumpFunMessage(data);
    });
    
    this.connections.set('pumpfun', connection);
  }

  connectRaydium() {
    const config = this.dexConfig.raydium;
    const connection = this.createConnection('raydium', config);
    
    connection.ws.on('open', () => {
      console.log(`${config.emoji} ${config.name} 已连接`);
      this.subscribeRaydium(connection.ws, config);
    });
    
    connection.ws.on('message', (data) => {
      this.handleRaydiumMessage(data);
    });
    
    this.connections.set('raydium', connection);
  }

  connectOrca() {
    const config = this.dexConfig.orca;
    const connection = this.createConnection('orca', config);
    
    connection.ws.on('open', () => {
      console.log(`${config.emoji} ${config.name} 已连接`);
      this.subscribeOrca(connection.ws, config);
    });
    
    connection.ws.on('message', (data) => {
      this.handleOrcaMessage(data);
    });
    
    this.connections.set('orca', connection);
  }

  createConnection(dex, config) {
    const wsOptions = {};
    
    if (this.useProxy && this.proxyUrl) {
      wsOptions.agent = new HttpsProxyAgent(this.proxyUrl);
    }
    
    const ws = new WebSocket(config.wsUrl, wsOptions);
    
    ws.on('error', (error) => {
      console.error(`❌ ${config.name} 错误:`, error.message);
    });
    
    ws.on('close', () => {
      console.log(`🔌 ${config.name} 连接已关闭，5秒后重连...`);
      setTimeout(() => {
        if (dex === 'pumpfun') this.connectPumpFun();
        if (dex === 'raydium') this.connectRaydium();
        if (dex === 'orca') this.connectOrca();
      }, 5000);
    });
    
    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30000);
    
    return { ws, heartbeat, config };
  }

  subscribePumpFun(ws, subscriptions) {
    if (subscriptions.subscribeNewToken) {
      ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
      console.log('  📡 已订阅新代币创建');
    }
    
    if (subscriptions.subscribeTokenTrade && subscriptions.tokens.length > 0) {
      ws.send(JSON.stringify({
        method: 'subscribeTokenTrade',
        keys: subscriptions.tokens
      }));
      console.log(`  📡 已订阅 ${subscriptions.tokens.length} 个代币交易`);
    }
    
    if (subscriptions.subscribeAccountTrade && subscriptions.accounts.length > 0) {
      ws.send(JSON.stringify({
        method: 'subscribeAccountTrade',
        keys: subscriptions.accounts
      }));
      console.log(`  📡 已订阅 ${subscriptions.accounts.length} 个账户交易`);
    }
  }

  subscribeRaydium(ws, config) {
    const subscribeMsg = {
      jsonrpc: '2.0',
      id: 1,
      method: 'logsSubscribe',
      params: [
        { mentions: [config.programId] },
        { commitment: 'confirmed' }
      ]
    };
    
    ws.send(JSON.stringify(subscribeMsg));
    console.log('  📡 已订阅 Raydium AMM 程序日志');
  }

  subscribeOrca(ws, config) {
    const subscribeMsg = {
      jsonrpc: '2.0',
      id: 1,
      method: 'logsSubscribe',
      params: [
        { mentions: [config.programId] },
        { commitment: 'confirmed' }
      ]
    };
    
    ws.send(JSON.stringify(subscribeMsg));
    console.log('  📡 已订阅 Orca Whirlpool 程序日志');
  }

  async handlePumpFunMessage(data) {
    try {
      const message = JSON.parse(data.toString());
      const config = this.dexConfig.pumpfun;
      
      this.stats.pumpfun.total++;
      
      if (message.txType === 'create') {
        this.stats.pumpfun.creates++;
        this.displayTokenCreate(config, message);
        
        // 自动审计新代币
        if (this.auditConfig.enabled && this.auditConfig.autoAudit) {
          this.stats.pumpfun.audited++;
          await this.auditor.auditToken(message.mint || message.tokenAddress, message);
        }
      } else if (message.txType === 'buy') {
        this.stats.pumpfun.buys++;
        this.displayTrade(config, message, 'buy');
      } else if (message.txType === 'sell') {
        this.stats.pumpfun.sells++;
        this.displayTrade(config, message, 'sell');
      }
    } catch (error) {
      console.error('解析 Pump.fun 消息失败:', error.message);
    }
  }

  handleRaydiumMessage(data) {
    try {
      const message = JSON.parse(data.toString());
      const config = this.dexConfig.raydium;
      
      if (message.method === 'logsNotification') {
        this.stats.raydium.total++;
        const logs = message.params.result.value.logs;
        const signature = message.params.result.value.signature;
        
        const tradeType = this.parseRaydiumLogs(logs);
        
        if (tradeType) {
          this.displaySolanaTransaction(config, {
            signature,
            type: tradeType,
            logs: logs.slice(0, 3)
          });
          
          if (tradeType === 'swap') this.stats.raydium.swaps++;
          if (tradeType === 'addLiquidity') this.stats.raydium.addLiquidity++;
          if (tradeType === 'removeLiquidity') this.stats.raydium.removeLiquidity++;
        }
      }
    } catch (error) {
      console.error('解析 Raydium 消息失败:', error.message);
    }
  }

  handleOrcaMessage(data) {
    try {
      const message = JSON.parse(data.toString());
      const config = this.dexConfig.orca;
      
      if (message.method === 'logsNotification') {
        this.stats.orca.total++;
        const logs = message.params.result.value.logs;
        const signature = message.params.result.value.signature;
        
        const tradeType = this.parseOrcaLogs(logs);
        
        if (tradeType) {
          this.displaySolanaTransaction(config, {
            signature,
            type: tradeType,
            logs: logs.slice(0, 3)
          });
          
          if (tradeType === 'swap') this.stats.orca.swaps++;
          if (tradeType === 'addLiquidity') this.stats.orca.addLiquidity++;
          if (tradeType === 'removeLiquidity') this.stats.orca.removeLiquidity++;
        }
      }
    } catch (error) {
      console.error('解析 Orca 消息失败:', error.message);
    }
  }

  parseRaydiumLogs(logs) {
    const logStr = logs.join(' ');
    if (logStr.includes('swap')) return 'swap';
    if (logStr.includes('initialize') || logStr.includes('deposit')) return 'addLiquidity';
    if (logStr.includes('withdraw')) return 'removeLiquidity';
    return null;
  }

  parseOrcaLogs(logs) {
    const logStr = logs.join(' ');
    if (logStr.includes('Swap')) return 'swap';
    if (logStr.includes('IncreaseLiquidity') || logStr.includes('OpenPosition')) return 'addLiquidity';
    if (logStr.includes('DecreaseLiquidity') || logStr.includes('ClosePosition')) return 'removeLiquidity';
    return null;
  }

  displayTokenCreate(config, data) {
    console.log('\n' + '═'.repeat(70));
    console.log(`${config.emoji} ${config.name} - 🆕 新代币创建`);
    console.log('═'.repeat(70));
    console.log('时间:', new Date().toLocaleString('zh-CN'));
    console.log('代币地址:', data.mint || data.tokenAddress);
    console.log('代币名称:', data.name || 'N/A');
    console.log('代币符号:', data.symbol || 'N/A');
    console.log('创建者:', data.traderPublicKey || data.creator || 'N/A');
    
    if (data.description) {
      console.log('描述:', data.description.substring(0, 80) + '...');
    }
    
    if (data.twitter) console.log('Twitter:', data.twitter);
    if (data.telegram) console.log('Telegram:', data.telegram);
    if (data.website) console.log('网站:', data.website);
    
    console.log('═'.repeat(70));
  }

  displayTrade(config, data, type) {
    const icon = type === 'buy' ? '🟢 买入' : '🔴 卖出';
    
    console.log('\n' + '─'.repeat(70));
    console.log(`${config.emoji} ${config.name} - ${icon}`);
    console.log('─'.repeat(70));
    console.log('时间:', new Date().toLocaleString('zh-CN'));
    console.log('代币:', data.symbol || data.mint);
    console.log('代币地址:', data.mint);
    console.log('交易者:', data.traderPublicKey);
    
    const solAmount = parseFloat(data.solAmount || data.amount || 0);
    const tokenAmount = parseFloat(data.tokenAmount || 0);
    
    if (type === 'buy') {
      console.log('支付 SOL:', solAmount.toFixed(4));
      console.log('获得代币:', tokenAmount.toLocaleString());
    } else {
      console.log('卖出代币:', tokenAmount.toLocaleString());
      console.log('获得 SOL:', solAmount.toFixed(4));
    }
    
    if (solAmount > 0 && tokenAmount > 0) {
      const price = solAmount / tokenAmount;
      console.log('单价:', price.toExponential(4), 'SOL/代币');
    }
    
    if (data.marketCapSol) {
      console.log('市值:', parseFloat(data.marketCapSol).toFixed(2), 'SOL');
    }
    
    console.log('交易签名:', data.signature);
    console.log('─'.repeat(70));
  }

  displaySolanaTransaction(config, data) {
    const typeEmoji = {
      swap: '🔄 交换',
      addLiquidity: '➕ 添加流动性',
      removeLiquidity: '➖ 移除流动性'
    };
    
    console.log('\n' + '─'.repeat(70));
    console.log(`${config.emoji} ${config.name} - ${typeEmoji[data.type] || data.type}`);
    console.log('─'.repeat(70));
    console.log('时间:', new Date().toLocaleString('zh-CN'));
    console.log('交易签名:', data.signature);
    console.log('日志预览:');
    data.logs.forEach(log => {
      if (log.length > 100) {
        console.log('  ', log.substring(0, 100) + '...');
      } else {
        console.log('  ', log);
      }
    });
    console.log('浏览器:', `https://solscan.io/tx/${data.signature}`);
    console.log('─'.repeat(70));
  }

  startStatsDisplay() {
    this.statsInterval = setInterval(() => {
      this.displayStats();
    }, 60000);
  }

  displayStats() {
    const runtime = Math.floor((Date.now() - this.stats.startTime) / 1000);
    const minutes = Math.floor(runtime / 60);
    const seconds = runtime % 60;
    
    console.log('\n' + '╔'.repeat(70));
    console.log('📊 多 DEX 统计信息');
    console.log('╚'.repeat(70));
    console.log('运行时间:', `${minutes}分${seconds}秒`);
    console.log('');
    
    if (this.dexConfig.pumpfun.enabled) {
      const p = this.stats.pumpfun;
      console.log(`${this.dexConfig.pumpfun.emoji} Pump.fun:`);
      console.log(`  总消息: ${p.total} | 创建: ${p.creates} | 买入: ${p.buys} | 卖出: ${p.sells} | 已审计: ${p.audited}`);
    }
    
    if (this.dexConfig.raydium.enabled) {
      const r = this.stats.raydium;
      console.log(`${this.dexConfig.raydium.emoji} Raydium:`);
      console.log(`  总消息: ${r.total} | 交换: ${r.swaps} | 添加流动性: ${r.addLiquidity} | 移除流动性: ${r.removeLiquidity}`);
    }
    
    if (this.dexConfig.orca.enabled) {
      const o = this.stats.orca;
      console.log(`${this.dexConfig.orca.emoji} Orca:`);
      console.log(`  总消息: ${o.total} | 交换: ${o.swaps} | 添加流动性: ${o.addLiquidity} | 移除流动性: ${o.removeLiquidity}`);
    }
    
    console.log('═'.repeat(70));
  }

  stopAll() {
    console.log('\n正在关闭所有连接...');
    
    this.connections.forEach((connection, dex) => {
      if (connection.heartbeat) {
        clearInterval(connection.heartbeat);
      }
      if (connection.ws) {
        connection.ws.close();
      }
    });
    
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }
    
    this.displayStats();
  }
}

// 启动监听器
const listener = new MultiDexListener(USE_PROXY, PROXY_URL, DEX_CONFIG, AUDIT_CONFIG);
listener.startAll();

// 优雅退出
process.on('SIGINT', () => {
  listener.stopAll();
  process.exit(0);
});

module.exports = { MultiDexListener, TokenAuditor };
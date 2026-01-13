// 1. 首先设置代理（必须在引入 @solana/web3.js 之前）
// 可以通过环境变量 HTTP_PROXY 或 http_proxy 设置，也可以直接传入代理地址
const { setupProxy } = require('../../../utils/setupProxy');
setupProxy('http://127.0.0.1:7890'); // 如果需要使用代理，传入代理地址；如果不需要，传入 null 或不传参数

// 2. 再引入 solana web3
const { Connection, clusterApiUrl } = require('@solana/web3.js');

// 配置多个 RPC 端点以提高连接成功率
const RPC_ENDPOINTS = [
  clusterApiUrl('devnet'),
  'https://api.devnet.solana.com',
  'https://devnet.solana.com',
  'https://rpc.ankr.com/solana_devnet'
];

async function createConnection() {
  for (const endpoint of RPC_ENDPOINTS) {
    try {
      console.log(`尝试连接: ${endpoint}`);
      const connection = new Connection(endpoint, {
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: 60000,
        disableRetryOnRateLimit: false
      });
      
      // 测试连接
      await connection.getVersion();
      console.log(`✓ 成功连接到: ${endpoint}\n`);
      return connection;
    } catch (err) {
      console.log(`✗ 连接失败: ${err.message}`);
      continue;
    }
  }
  throw new Error('无法连接到任何 Solana Devnet RPC 端点');
}

async function findSolanaNodes() {
  console.log('正在连接 Solana Devnet...\n');

  try {
    // 创建连接
    const connection = await createConnection();
    
    // 1. 获取所有 Validator 节点
    console.log('=== 获取 Validator 节点 ===');
    const voteAccounts = await connection.getVoteAccounts();
    
    console.log(`\n当前活跃的 Validators 数量: ${voteAccounts.current.length}`);
    console.log(`离线的 Validators 数量: ${voteAccounts.delinquent.length}\n`);
    
    // 显示前 5 个活跃的 Validator
    console.log('前 5 个活跃的 Validators:');
    voteAccounts.current.slice(0, 5).forEach((validator, index) => {
      console.log(`\n${index + 1}. Node Public Key: ${validator.nodePubkey}`);
      console.log(`   Vote Account: ${validator.votePubkey}`);
      console.log(`   Activated Stake: ${(validator.activatedStake / 1e9).toFixed(2)} SOL`);
      console.log(`   Commission: ${validator.commission}%`);
      console.log(`   Last Vote: ${validator.lastVote}`);
    });

    // 2. 获取当前 Leader Schedule
    console.log('\n\n=== 获取 Leader Schedule ===');
    const epoch = await connection.getEpochInfo();
    console.log(`\n当前 Epoch: ${epoch.epoch}`);
    console.log(`当前 Slot: ${epoch.slotIndex}/${epoch.slotsInEpoch}`);
    console.log(`Epoch 完成度: ${((epoch.slotIndex / epoch.slotsInEpoch) * 100).toFixed(2)}%`);
    
    // 获取当前 epoch 的 leader schedule
    console.log('\n正在获取 Leader Schedule...');
    const leaderSchedule = await connection.getLeaderSchedule();
    
    if (leaderSchedule) {
      const leaders = Object.keys(leaderSchedule);
      console.log(`当前 Epoch 中的 Leader 节点数量: ${leaders.length}`);
      
      // 显示前 5 个 Leader 及其负责的 slots
      console.log('\n前 5 个 Leader 节点及其负责的 Slots:');
      leaders.slice(0, 5).forEach((leader, index) => {
        const slots = leaderSchedule[leader];
        console.log(`\n${index + 1}. Leader Public Key: ${leader}`);
        console.log(`   负责的 Slot 数量: ${slots.length}`);
        console.log(`   前 5 个 Slots: ${slots.slice(0, 5).join(', ')}`);
      });
    }

    // 3. 获取当前 Slot 的 Leader
    console.log('\n\n=== 当前 Slot Leader ===');
    const currentSlot = await connection.getSlot();
    const currentLeader = await connection.getSlotLeader();
    
    console.log(`\n当前 Slot: ${currentSlot}`);
    if (currentLeader) {
      // 检查是否为 PublicKey 对象（有 toBase58 方法）
      const leaderPubkey = currentLeader.toBase58 ? currentLeader.toBase58() : currentLeader;
      console.log(`当前 Slot Leader: ${leaderPubkey}`);
    } else {
      console.log(`当前 Slot Leader: 无（可能正在切换 Leader）`);
    }

    // 4. 获取集群节点信息
    console.log('\n\n=== 集群节点信息 ===');
    const clusterNodes = await connection.getClusterNodes();
    
    console.log(`\n集群中的节点总数: ${clusterNodes.length}`);
    console.log('\n前 3 个节点的详细信息:');
    clusterNodes.slice(0, 3).forEach((node, index) => {
      console.log(`\n${index + 1}. Public Key: ${node.pubkey}`);
      console.log(`   Gossip: ${node.gossip || 'N/A'}`);
      console.log(`   RPC: ${node.rpc || 'N/A'}`);
      console.log(`   Version: ${node.version || 'N/A'}`);
      console.log(`   Feature Set: ${node.featureSet || 'N/A'}`);
    });

    // 5. 获取性能样本
    console.log('\n\n=== 网络性能 ===');
    const perfSamples = await connection.getRecentPerformanceSamples(1);
    if (perfSamples && perfSamples.length > 0) {
      const sample = perfSamples[0];
      console.log(`\nSlot 范围: ${sample.slot}`);
      console.log(`交易数量: ${sample.numTransactions}`);
      console.log(`采样周期秒数: ${sample.samplePeriodSecs}`);
      console.log(`TPS: ${(sample.numTransactions / sample.samplePeriodSecs).toFixed(2)}`);
    }

  } catch (error) {
    console.error('\n❌ 错误:', error.message);
    console.error('\n可能的解决方案:');
    console.error('1. 检查网络连接');
    console.error('2. 如果在中国大陆，可能需要配置代理');
    console.error('3. 尝试使用 VPN');
    console.error('4. 检查防火墙设置');
    console.error('5. 确认 @solana/web3.js 版本是最新的: npm update @solana/web3.js');
  }
}

// 执行函数
console.log('Solana Devnet 节点查询工具');
console.log('================================\n');

findSolanaNodes().then(() => {
  console.log('\n\n✓ 查询完成！');
  process.exit(0);
}).catch(err => {
  console.error('\n❌ 执行出错:', err.message);
  process.exit(1);
});
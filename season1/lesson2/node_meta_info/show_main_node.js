// 1. 首先设置代理（必须在引入 @solana/web3.js 之前）
// 可以通过环境变量 HTTP_PROXY 或 http_proxy 设置，也可以直接传入代理地址
const { setupProxy } = require('../../../utils/setupProxy');
setupProxy('http://127.0.0.1:7890'); // 如果需要使用代理，传入代理地址；如果不需要，传入 null 或不传参数

// 2. 再引入 solana web3
const { Connection, clusterApiUrl } = require('@solana/web3.js');

// 配置多个主网 RPC 端点以提高连接成功率
const RPC_ENDPOINTS = [
  clusterApiUrl('mainnet-beta'),
  'https://api.mainnet-beta.solana.com',
  'https://solana-api.projectserum.com',
  'https://rpc.ankr.com/solana',
  'https://solana-mainnet.rpc.extrnode.com'
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
  throw new Error('无法连接到任何 Solana Mainnet RPC 端点');
}

async function findSolanaNodes() {
  console.log('正在连接 Solana Mainnet...\n');

  try {
    // 创建连接
    const connection = await createConnection();
    
    // 1. 获取所有 Validator 节点
    console.log('=== 获取 Validator 节点 ===');
    const voteAccounts = await connection.getVoteAccounts();
    
    console.log(`\n当前活跃的 Validators 数量: ${voteAccounts.current.length}`);
    console.log(`离线的 Validators 数量: ${voteAccounts.delinquent.length}`);
    
    // 计算总质押量
    const totalStake = voteAccounts.current.reduce((sum, v) => sum + v.activatedStake, 0);
    console.log(`总活跃质押量: ${(totalStake / 1e9).toFixed(2)} SOL`);
    
    // 按质押量排序并显示前 10 个 Validator
    const sortedValidators = [...voteAccounts.current].sort((a, b) => 
      b.activatedStake - a.activatedStake
    );
    
    console.log('\n前 10 个质押量最高的 Validators:');
    sortedValidators.slice(0, 10).forEach((validator, index) => {
      const stakePercent = (validator.activatedStake / totalStake * 100).toFixed(2);
      console.log(`\n${index + 1}. Node Public Key: ${validator.nodePubkey}`);
      console.log(`   Vote Account: ${validator.votePubkey}`);
      console.log(`   Activated Stake: ${(validator.activatedStake / 1e9).toFixed(2)} SOL (${stakePercent}%)`);
      console.log(`   Commission: ${validator.commission}%`);
      console.log(`   Last Vote: ${validator.lastVote}`);
      console.log(`   Root Slot: ${validator.rootSlot}`);
    });

    // 2. 获取当前 Epoch 信息
    console.log('\n\n=== Epoch 信息 ===');
    const epoch = await connection.getEpochInfo();
    console.log(`\n当前 Epoch: ${epoch.epoch}`);
    console.log(`当前 Slot: ${epoch.slotIndex}/${epoch.slotsInEpoch}`);
    console.log(`绝对 Slot: ${epoch.absoluteSlot}`);
    console.log(`Epoch 完成度: ${((epoch.slotIndex / epoch.slotsInEpoch) * 100).toFixed(2)}%`);
    console.log(`区块高度: ${epoch.blockHeight}`);
    
    // 计算剩余时间（假设每个 slot 400ms）
    const remainingSlots = epoch.slotsInEpoch - epoch.slotIndex;
    const remainingSeconds = remainingSlots * 0.4;
    const remainingHours = (remainingSeconds / 3600).toFixed(2);
    console.log(`预计剩余时间: ${remainingHours} 小时`);

    // 3. 获取当前 Slot 的 Leader
    console.log('\n\n=== 当前 Slot Leader ===');
    const currentSlot = await connection.getSlot();
    const currentLeader = await connection.getSlotLeader();
    
    console.log(`\n当前 Slot: ${currentSlot}`);
    if (currentLeader) {
      // 检查是否为 PublicKey 对象（有 toBase58 方法）
      const leaderPubkey = currentLeader.toBase58 ? currentLeader.toBase58() : currentLeader;
      console.log(`当前 Slot Leader: ${leaderPubkey}`);
      
      // 查找当前 Leader 的详细信息
      const leaderInfo = voteAccounts.current.find(v => v.nodePubkey === leaderPubkey);
      if (leaderInfo) {
        console.log(`\nLeader 详细信息:`);
        console.log(`   Activated Stake: ${(leaderInfo.activatedStake / 1e9).toFixed(2)} SOL`);
        console.log(`   Commission: ${leaderInfo.commission}%`);
      }
    } else {
      console.log(`当前 Slot Leader: 无（可能正在切换 Leader）`);
    }

    // 4. 获取 Leader Schedule（注意：主网的 Leader Schedule 很大，这里只获取部分）
    console.log('\n\n=== Leader Schedule 统计 ===');
    console.log('正在获取 Leader Schedule（这可能需要一些时间）...');
    
    try {
      const leaderSchedule = await connection.getLeaderSchedule();
      
      if (leaderSchedule) {
        const leaders = Object.keys(leaderSchedule);
        console.log(`\n当前 Epoch 中的 Leader 节点数量: ${leaders.length}`);
        
        // 计算每个 leader 的 slot 数量
        const leaderSlotCounts = leaders.map(leader => ({
          pubkey: leader,
          slotCount: leaderSchedule[leader].length
        })).sort((a, b) => b.slotCount - a.slotCount);
        
        console.log('\n前 5 个拥有最多 Slots 的 Leader:');
        leaderSlotCounts.slice(0, 5).forEach((leader, index) => {
          const percentage = (leader.slotCount / epoch.slotsInEpoch * 100).toFixed(2);
          console.log(`\n${index + 1}. Leader: ${leader.pubkey}`);
          console.log(`   负责的 Slot 数量: ${leader.slotCount} (${percentage}%)`);
        });
      }
    } catch (err) {
      console.log('获取 Leader Schedule 失败（这在主网上很常见，因为数据量很大）');
    }

    // 5. 获取集群节点信息
    console.log('\n\n=== 集群节点信息 ===');
    const clusterNodes = await connection.getClusterNodes();
    
    console.log(`\n集群中的节点总数: ${clusterNodes.length}`);
    
    // 统计版本分布
    const versionMap = {};
    clusterNodes.forEach(node => {
      const version = node.version || 'unknown';
      versionMap[version] = (versionMap[version] || 0) + 1;
    });
    
    console.log('\n节点版本分布:');
    Object.entries(versionMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([version, count]) => {
        console.log(`   ${version}: ${count} 个节点`);
      });
    
    console.log('\n前 3 个节点的详细信息:');
    clusterNodes.slice(0, 3).forEach((node, index) => {
      console.log(`\n${index + 1}. Public Key: ${node.pubkey}`);
      console.log(`   Gossip: ${node.gossip || 'N/A'}`);
      console.log(`   RPC: ${node.rpc || 'N/A'}`);
      console.log(`   TPU: ${node.tpu || 'N/A'}`);
      console.log(`   Version: ${node.version || 'N/A'}`);
    });

    // 6. 获取网络性能
    console.log('\n\n=== 网络性能统计 ===');
    const perfSamples = await connection.getRecentPerformanceSamples(5);
    if (perfSamples && perfSamples.length > 0) {
      console.log('\n最近 5 个性能样本:');
      perfSamples.forEach((sample, index) => {
        const tps = (sample.numTransactions / sample.samplePeriodSecs).toFixed(2);
        console.log(`\n${index + 1}. Slot: ${sample.slot}`);
        console.log(`   交易数量: ${sample.numTransactions}`);
        console.log(`   采样周期: ${sample.samplePeriodSecs} 秒`);
        console.log(`   TPS: ${tps}`);
      });
      
      // 计算平均 TPS
      const avgTPS = perfSamples.reduce((sum, s) => 
        sum + (s.numTransactions / s.samplePeriodSecs), 0
      ) / perfSamples.length;
      console.log(`\n平均 TPS: ${avgTPS.toFixed(2)}`);
    }

    // 7. 获取供应量信息
    console.log('\n\n=== SOL 供应量信息 ===');
    const supply = await connection.getSupply();
    console.log(`\n总供应量: ${(supply.value.total / 1e9).toFixed(2)} SOL`);
    console.log(`流通供应量: ${(supply.value.circulating / 1e9).toFixed(2)} SOL`);
    console.log(`非流通供应量: ${(supply.value.nonCirculating / 1e9).toFixed(2)} SOL`);

  } catch (error) {
    console.error('\n❌ 错误:', error.message);
    console.error('\n可能的解决方案:');
    console.error('1. 检查网络连接');
    console.error('2. 如果在中国大陆，可能需要配置代理');
    console.error('3. 尝试使用 VPN');
    console.error('4. 某些 RPC 端点可能有速率限制，请稍后重试');
    console.error('5. 考虑使用付费 RPC 服务（如 QuickNode, Alchemy）获得更好的性能');
  }
}

// 执行函数
console.log('╔═══════════════════════════════════════════╗');
console.log('║   Solana Mainnet 节点查询工具               ║');
console.log('╚═══════════════════════════════════════════╝\n');

findSolanaNodes().then(() => {
  console.log('\n\n✓ 查询完成！');
  process.exit(0);
}).catch(err => {
  console.error('\n❌ 执行出错:', err.message);
  process.exit(1);
});
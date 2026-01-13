import { setGlobalDispatcher, ProxyAgent } from 'undici';

/**
 * 设置全局代理配置
 * 必须在引入 @solana/web3.js 之前调用
 * @param {string|null} proxyUrl - 代理地址，例如 'http://127.0.0.1:7890'，如果为 null 或空字符串则不设置代理
 */
export function setupProxy(proxyUrl = null) {
  // 优先使用环境变量，如果没有则使用传入的参数
  const finalProxyUrl = process.env.HTTP_PROXY || process.env.http_proxy || proxyUrl;
  
  if (finalProxyUrl) {
    const proxyAgent = new ProxyAgent(finalProxyUrl);
    setGlobalDispatcher(proxyAgent);
    console.log(`✓ 代理已设置: ${finalProxyUrl}`);
  } else {
    console.log('ℹ 未设置代理');
  }
}


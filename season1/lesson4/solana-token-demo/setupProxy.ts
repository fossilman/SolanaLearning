import { setGlobalDispatcher, ProxyAgent } from 'undici';

/**
 * 设置全局代理配置
 * 必须在引入 @solana/web3.js 之前调用
 * 可以通过环境变量 HTTP_PROXY 或 http_proxy 设置，也可以直接修改下面的默认值
 */
const PROXY_URL = process.env.HTTP_PROXY || process.env.http_proxy || 'http://127.0.0.1:7890'; // 默认代理地址，如需禁用可设为 null

// 模块加载时自动设置代理
if (PROXY_URL) {
  const proxyAgent = new ProxyAgent(PROXY_URL);
  setGlobalDispatcher(proxyAgent);
  console.log(`✓ 代理已设置: ${PROXY_URL}`);
} else {
  console.log('ℹ 未设置代理');
}

/**
 * 手动设置代理的函数（可选，如果需要动态设置）
 * @param proxyUrl - 代理地址，例如 'http://127.0.0.1:7890'，如果为 null 或空字符串则不设置代理
 */
export function setupProxy(proxyUrl: string | null = null): void {
  const finalProxyUrl = process.env.HTTP_PROXY || process.env.http_proxy || proxyUrl;
  
  if (finalProxyUrl) {
    const proxyAgent = new ProxyAgent(finalProxyUrl);
    setGlobalDispatcher(proxyAgent);
    console.log(`✓ 代理已设置: ${finalProxyUrl}`);
  } else {
    console.log('ℹ 未设置代理');
  }
}

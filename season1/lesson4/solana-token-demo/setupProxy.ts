import { HttpsProxyAgent } from 'https-proxy-agent';
import { setGlobalDispatcher, ProxyAgent } from 'undici';
import WebSocket from 'ws';

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

  // 设置 WebSocket 代理
  const httpsAgent = new HttpsProxyAgent(PROXY_URL);
  const originalWebSocket = global.WebSocket || WebSocket;
  
  // 重写全局 WebSocket 构造函数以支持代理
  (global as any).WebSocket = class extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[], options?: any) {
      // 将 URL 转换为字符串以便检查协议
      const urlString = typeof url === 'string' ? url : url.toString();
      
      // 为所有 WebSocket 连接（ws:// 和 wss://）设置代理
      const wsOptions = {
        ...options,
        agent: (urlString.startsWith('ws://') || urlString.startsWith('wss://')) 
          ? httpsAgent 
          : (options?.agent || undefined)
      };
      
      // ws 库的构造函数签名: (url, protocols?, options?)
      if (protocols) {
        super(url, protocols, wsOptions);
      } else {
        super(url, wsOptions);
      }
    }
  };

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

    // WebSocket 代理
    const httpsAgent = new HttpsProxyAgent(finalProxyUrl);
    const originalWebSocket = global.WebSocket || WebSocket;
    
    (global as any).WebSocket = class extends WebSocket {
      constructor(url: string | URL, protocols?: string | string[], options?: any) {
        // 将 URL 转换为字符串以便检查协议
        const urlString = typeof url === 'string' ? url : url.toString();
        
        // 为所有 WebSocket 连接（ws:// 和 wss://）设置代理
        const wsOptions = {
          ...options,
          agent: (urlString.startsWith('ws://') || urlString.startsWith('wss://')) 
            ? httpsAgent 
            : (options?.agent || undefined)
        };
        
        // ws 库的构造函数签名: (url, protocols?, options?)
        if (protocols) {
          super(url, protocols, wsOptions);
        } else {
          super(url, wsOptions);
        }
      }
    };
    console.log(`✓ 代理已设置: ${finalProxyUrl}`);
  } else {
    console.log('ℹ 未设置代理');
  }
}

// 1. 设置代理（一定要最先执行）
// 可以通过环境变量 HTTP_PROXY 或 http_proxy 设置，也可以直接传入代理地址
import { setupProxy } from "./setupProxy.mjs";
setupProxy("http://127.0.0.1:7890"); // 如果需要使用代理，传入代理地址；如果不需要，传入 null 或不传参数

// 2. 再引入 solana web3
import { Connection } from "@solana/web3.js";

async function main() {
  const connection = new Connection(
    "https://api.mainnet-beta.solana.com",
    "confirmed"
  );

  const slot = await connection.getSlot();
  console.log("slot:", slot);
}

main();


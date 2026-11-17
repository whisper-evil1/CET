/**
 * 发布前打一个「构建令牌」，强制沙箱重建。
 *
 * 为什么要这个东西：
 *   发布平台会复用上一次的沙箱，里面的 .next 是上一版源码构建的。
 *   启动器本来靠「源码内容指纹」判断要不要重建 —— 逻辑没错，但一旦
 *   某次上传没把最新源码送进去（或沙箱里的旧产物指纹恰好一致），
 *   就会出现「部署显示成功、线上还是老版本」这种最难查的问题。
 *   这个文件参与指纹计算，发布前改一下，指纹必然变化，必然重建。
 */
import fs from "node:fs";
import path from "node:path";

const file = path.join("scripts", "build-nonce.txt");
const stamp = `${new Date().toISOString()} ${Math.random().toString(36).slice(2, 8)}`;
fs.writeFileSync(file, `${stamp}\n`, "utf8");
console.log(`[build-nonce] ${stamp}`);

#!/usr/bin/env node
/**
 * 回收旧的 Next 服务进程（部署启动前调用）。
 *
 * 为什么不用 shell 的 `for p in /proc/*`：
 *   那条命令本身是通过 `sh -c "<startCmd>"` 执行的，cmdline 里就包含了
 *   "server.cjs" 这个字符串，扫描时会把执行它的 shell 一起 kill 掉，
 *   表现为「服务没起来、stderr 为空、进程列表里什么都没有」。
 *   我第一次部署就是这么翻车的。
 *
 * 这里的判定：只处理 ①可执行文件基名是 node ②命令行里带 next-server /
 * dist/bin/next / server.cjs ③不是自己、不是父进程。`sh -c ...` 的基名是 sh，
 * 天然被排除，不会自杀。
 */
const fs = require("node:fs");

const self = process.pid;
const parent = process.ppid;

let killed = 0;
const dirs = fs.existsSync("/proc") ? fs.readdirSync("/proc") : [];

for (const d of dirs) {
  if (!/^\d+$/.test(d)) continue;
  const pid = Number(d);
  if (pid === self || pid === parent || pid === 1) continue;

  let parts;
  try {
    parts = fs
      .readFileSync(`/proc/${pid}/cmdline`)
      .toString("utf8")
      .split("\0")
      .filter(Boolean);
  } catch {
    continue; // 进程已退出或无权限
  }
  if (!parts.length) continue;

  const exe = parts[0].split("/").pop() ?? "";
  if (exe !== "node") continue; // 只处理 node 进程，sh / bash 一律跳过

  const full = parts.join(" ");
  if (!/(next-server|dist\/bin\/next|server\.cjs)/.test(full)) continue;
  // 不要把我们自己这个脚本也算进去（基名是 node 且含 server.cjs 的可能只有它）
  if (/kill-old\.cjs/.test(full)) continue;

  try {
    process.kill(pid, "SIGKILL");
    killed += 1;
    console.log(`[kill-old] 已停止旧进程 pid=${pid} ${full.slice(0, 70)}`);
  } catch (e) {
    console.log(`[kill-old] 跳过 pid=${pid}: ${e.message}`);
  }
}

console.log(`[kill-old] 完成，共停止 ${killed} 个进程`);

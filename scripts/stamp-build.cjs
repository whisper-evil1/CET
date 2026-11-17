/**
 * 构建结束后落「源码指纹」，供启动器判断产物是否与源码一致。
 * 由 npm script build 自动调用，不需要手动跑。
 */
const { writeStamp, DIST } = require("./build-meta.cjs");

const fp = writeStamp();
console.log(`[stamp-build] 已记录源码指纹 ${fp} → ${DIST}/.src-hash`);

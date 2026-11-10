import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      // 构建中间产物（tsc 编译 src/lib/*.ts 到 .build 供 node 直接跑测试）
      ".build/**",
      "out/**",
      "build/**",
      "verify-out.txt",
      "next-env.d.ts",
    ],
  },
  {
    // 生产启动器 server.cjs 与历史上按 CJS 写的脚本：require 是它们的唯一写法，
    // 这条规则针对的是 ESM 源码，不该套在 .cjs 上。
    files: ["**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
];

export default eslintConfig;

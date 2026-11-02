# 左文右题 · 四六级阅读刷题

左边滚动原文，右边答题，**两栏滚动互不干扰**。点任意单词即查、查过的词自动进生词本循环复习，每题都能问 AI、写自己的笔记（默认仅自己可见）。

> ⚠️ **现状说明（v2.0）**：当前代码为 v2.0（套卷 Section 结构 / 打卡 / 排行榜已完成；写作翻译与听力为半成品）。
> 本文件偏产品说明，**最新权威现状以交接包顶层 `00_给AI先读我.md` 为准**，表结构与 API 以 `prisma/schema.prisma` 和 `src/` 实际代码为准。

---

## 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Next.js 15（App Router）+ React 19 + TypeScript strict |
| 样式 | Tailwind CSS v4 + 自定义设计令牌（`src/app/globals.css`） |
| 数据 | Prisma 6 + SQLite（本地零依赖；切 PostgreSQL 只改两处） |
| 认证 | NextAuth v5 Credentials + bcrypt + JWT session |
| 状态 | zustand（刷题页局部状态）+ SWR（服务端数据） |
| 校验 | zod（所有 API 入参） |
| AI | OpenAI 兼容协议（默认 DeepSeek），无 Key 自动降级为模拟流式 |

## 快速开始

```bash
cd cet-reader
npm install          # 依赖已装好可跳过
npm run setup        # prisma generate + 建表 + 灌种子数据
npm run dev          # http://localhost:3000
```

`npm run setup` 等价于：

```bash
npx prisma generate
npx prisma db push
npm run db:seed
```

### 演示账号（种子数据自带）

| 账号 | 密码 | 用途 |
|---|---|---|
| `demo@cet.local` | `demo1234` | 主要测试账号 |
| `alice@cet.local` | `demo1234` | 验证「私密笔记换个账号看不到」 |

注册自己的账号也可以，登录页顶部切到「注册」。

## 环境变量

复制 `.env.example` 为 `.env`（仓库里已带一份可直接用的 `.env`）：

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | 默认 `file:./dev.db`（SQLite 文件库） |
| `AUTH_SECRET` | NextAuth 签名密钥，线上务必换新的 |
| `AI_PROVIDER` | `deepseek` / `dashscope` / `zhipu` / `moonshot` |
| `AI_API_KEY` | **留空也能用**：AI 抽屉走内置模拟流式，查词退到内置词库 |
| `AI_BASE_URL` / `AI_MODEL` | 换厂商时覆盖默认值即可 |

换一家厂商只改三行，例如通义千问：

```env
AI_PROVIDER="dashscope"
AI_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"
AI_MODEL="qwen-plus"
```

## 目录结构

```
cet-reader/
├─ prisma/
│  ├─ schema.prisma          13 张表（v2.0）：User/Paper/Section/Passage/Question/Answer/Comment/
│  │                         VocabWord/Favorite/DictionaryEntry/UserStats/Checkin/ExperiencePack
│  │                         注意：Passage 同时保留必填 paperId 与可选 sectionId（增量迁移策略，勿删 paperId）
│  └─ seed.ts                2 套试卷 + 逐项解析 + 演示账号
├─ src/
│  ├─ app/
│  │  ├─ page.tsx                    首页：试卷列表 + 学习概览
│  │  ├─ login/                      登录 / 注册
│  │  ├─ practice/[paperId]/         核心刷题页（左右分屏）
│  │  ├─ vocab/                      生词复习（卡片翻转）
│  │  ├─ favorites/                  收藏题目
│  │  ├─ profile/                    个人中心
│  │  └─ api/                        papers · answers · comments · favorites · vocab · lookup · ai/chat · me/stats
│  ├─ components/
│  │  ├─ practice/                   article-pane · question-pane · option-list · analysis-panel
│  │  │                              · word-card · comment-drawer · ai-drawer · practice-shell
│  │  └─ vocab/                      复习卡片
│  ├─ lib/
│  │  ├─ auth.ts                      NextAuth 配置 + currentUserId()
│  │  ├─ ai.ts                        上下文注入 + 流式转发 + 模拟流式
│  │  ├─ dict.ts                      查词三级链路
│  │  ├─ sanitize.ts                  留言 XSS 白名单清洗
│  │  ├─ rate-limit.ts                滑动窗口限流
│  │  └─ text-segments.ts             分词 / 语境截取
│  ├─ stores/practice.ts              刷题页状态（当前题、作答、收藏、生词、字号）
│  └─ data/builtin-dict.ts            内置离线词库（无 Key 也能查词）
```

## 关键实现说明

### 1. 两栏独立滚动（产品地基）

- 左栏、右栏是两个独立的 `overflow-y: auto` 容器，各自维护自己的 `scrollTop`
- 切题时只读写**右栏**的 `scrollTop`，并按 `questionId` 存档（`practice-shell.tsx` 的 `useLayoutEffect`）
- 左栏在切题过程中完全不参与任何滚动计算，所以位置必然不变
- 手机端（<768px）切换「文章 / 题目」用 `visibility` 控制而非 `display:none`，两个容器始终留在 DOM 里，滚动位置天然保留

### 2. 答案不下发首屏

`GET /api/papers/[id]` 只返回题干和选项；`answer` / `analysis` 必须通过 `POST /api/answers` 提交后换取。解析首次展开还会写入 `viewedAnalysis`。

### 3. 私密笔记服务端强制鉴权

`GET /api/questions/[id]/comments` 里，`visibility = private` 的查询条件被硬编码为 `userId = 当前登录用户`，前端拿不到别人的私密数据。公开后不可撤回（`PATCH` 只接受 `visibility: "public"`）。

### 4. 留言 XSS

写入前用 `sanitizePlainText()` 做白名单清洗：剥掉所有 HTML 标签、控制字符、零宽字符，长度截到 500；渲染时走 JSX 文本节点（React 默认转义），双保险。

### 5. 查词三级链路

`DictionaryEntry` 缓存 → 内置离线词库（`src/data/builtin-dict.ts`，覆盖种子文章重点词 + 四六级高频词）→ AI 生成中文释义。每级命中都回写缓存，同一单词只真正查一次。

### 6. 生词复习规则

| 操作 | 效果 |
|---|---|
| 认识 | `reviewCount += 1` |
| 不认识 | `reviewCount` 不变，`correctStreak` 归零 |
| `reviewCount >= 3` | `status = mastered`，自动移出复习队列（数据保留） |

## 验收清单（自测步骤）

| # | 标准 | 怎么验 |
|---|---|---|
| 1 | 滚左栏，右栏不动 | 打开任一试卷，滚文章到底，观察右侧题目位置 |
| 2 | 右栏切题，左栏不动 | 滚到文章中间 → 连点「下一题」→ 再切回，文章位置应保持 |
| 3 | 点词弹词卡且不溢出 | 点右下角的单词，词卡应向上翻转；点最右侧单词应向左偏移 |
| 4 | 加入生词本后正文有淡黄底 | 词卡点「加入生词本」，该词立即变淡黄底 |
| 5 | 认识 3 次移出复习队列 | `/vocab` 同一词点 3 次「认识」→ 消失；「已掌握」tab 里能查到 |
| 6 | 私密笔记他人不可见 | demo 账号写一条私密笔记 → 退出 → 用 alice 登录同一题 → 看不到 |
| 7 | AI 引用当前题目 | 打开「问 AI」→ 问「这题为什么选 X」→ 回答应引用原文段落 |
| 8 | 响应式 | 窗口 ≥1024px 左右分屏；缩到 <768px 出现「文章/题目」Tab |
| 9 | 键盘全流程 | `1-4` 选答案 → `Enter` 提交 → `Space` 展开解析 → `→` 下一题 |

## 常用命令

```bash
npm run dev          # 开发服务器
npm run build        # 生产构建
npm run typecheck    # tsc --noEmit
npm run db:reset     # 清库重建 + 重新灌种子数据
npm run db:studio    # Prisma Studio 可视化看数据

# 自动化验收（先启动服务再跑；会改动演示数据，跑完建议 npm run db:reset）
node scripts/smoke.mjs          # 49 项接口级断言：鉴权、判题、私密留言隔离、生词规则、查词、AI 流式
node scripts/visual-check.mjs   # 21 项浏览器级断言：真实滚动验证两栏互不干扰 + 11 张截图到 ./shots
```

## 换成 PostgreSQL

1. `prisma/schema.prisma` 里 `provider = "sqlite"` → `"postgresql"`
2. `.env` 的 `DATABASE_URL` 改成 `postgresql://...`
3. JSON 字段可以顺手把 `String` 改回 `Json`（解析逻辑已收敛在 `src/lib/db-mappers.ts`）
4. `npx prisma migrate dev --name init && npm run db:seed`

## 已知限制（v1 范围外）

- 未做听力 / 写作 / 翻译模块
- 错题本未自动归集（先用「收藏」代替）
- 评论只做一级回复，不做无限嵌套
- 题库只有 2 套种子卷，正式题目需自行导入（结构见 `prisma/seed.ts`）
- AI 对话不落库，刷新即清空（符合 PRD 的 F4.4）

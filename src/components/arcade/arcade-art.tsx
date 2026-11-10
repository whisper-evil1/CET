/**
 * 趣味闯关页的图形素材。
 *
 * 为什么手写 SVG 而不是放图片：项目一直是零图片请求（纸纹都是 CSS 渐变画的），
 * 插画一旦走 <img>，320 宽的小屏要么糊要么被裁，还要多 3~5 个网络请求。
 * 这里全部用 path/circle/rect 拼，服务端直出、缩放不糊、旧内核也能解析。
 *
 * 配色只在这四个值里取，避免「五颜六色堆一起」：
 *   蓝 #3882f6 主 / 浅蓝 #eaf1fe 底 / 琥珀 #f59e0b 强调 / 绿 #10b981 通过
 */

const BLUE = "#3882f6";
const BLUE_SOFT = "#eaf1fe";
const AMBER = "#f59e0b";
const GREEN = "#10b981";
const LINE = "#dfe4ec";

/* ---------------- 主 Banner 插画：摊开的书 + 飞出的词卡 ---------------- */

export function BannerArt() {
  return (
    <svg viewBox="0 0 320 220" className="h-full w-full" aria-hidden="true" role="presentation" preserveAspectRatio="xMidYMid slice">
      {/* 背景色块：两层椭圆，代替模糊阴影，避免 filter 在旧内核上发灰 */}
      <ellipse cx="176" cy="120" rx="140" ry="96" fill={BLUE_SOFT} />
      <ellipse cx="232" cy="72" rx="62" ry="46" fill="#f3f7ff" />

      {/* 摊开的书 */}
      <path
        d="M62 132c22-12 42-12 60 0 18-12 38-12 60 0v56c-22-11-42-11-60 0-18-11-38-11-60 0z"
        fill="#ffffff"
        stroke="#cfe0fb"
        strokeWidth="2"
      />
      <path d="M122 132v56" stroke="#cfe0fb" strokeWidth="2" />
      {/* 书页上的字行 */}
      <path
        d="M78 146h32M78 158h32M78 170h22M134 146h32M134 158h32M134 170h22"
        stroke="#dfe4ec"
        strokeWidth="3"
        strokeLinecap="round"
      />

      {/* 飞出的词卡 1：ABC */}
      <g transform="rotate(-8 246 44)">
        <rect x="206" y="26" width="80" height="40" rx="10" fill="#ffffff" stroke="#e6eefc" strokeWidth="2" />
        <text x="246" y="53" textAnchor="middle" fontSize="17" fontWeight="700" fill={BLUE} fontFamily="monospace">
          ABC
        </text>
      </g>

      {/* 飞出的词卡 2：词 */}
      <g transform="rotate(6 84 44)">
        <rect x="48" y="24" width="52" height="46" rx="12" fill="#fff8e8" stroke="#f6e3ba" strokeWidth="2" />
        <text x="74" y="55" textAnchor="middle" fontSize="20" fontWeight="700" fill={AMBER} fontFamily="serif">
          词
        </text>
      </g>

      {/* 通过标记 */}
      <circle cx="270" cy="156" r="17" fill={GREEN} />
      <path d="M262 156l6 6 11-12" stroke="#ffffff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />

      {/* 星点 */}
      <path d="M188 28l2.4 5.6 5.6 2.4-5.6 2.4L188 44l-2.4-5.6-5.6-2.4 5.6-2.4z" fill={AMBER} />
      <path d="M292 106l1.8 4.2 4.2 1.8-4.2 1.8-1.8 4.2-1.8-4.2-4.2-1.8 4.2-1.8z" fill="#9dc0f8" />
      <circle cx="152" cy="42" r="3.4" fill="#9dc0f8" />
      <circle cx="34" cy="120" r="4" fill="#cfe0fb" />
    </svg>
  );
}

/* ---------------- 三关卡片插画 ---------------- */

export function VocabArt() {
  return (
    <svg viewBox="0 0 120 84" className="h-full w-full" aria-hidden="true" role="presentation">
      {/* 后面那张卡要留出左边的「Aa」：两张卡一叠，前卡会把后卡右半边盖住，
          所以字母必须落在前卡左边之外（x < 54），否则就成了半个 A。 */}
      <rect x="4" y="22" width="52" height="40" rx="9" fill="#ffffff" stroke="#bfe6d2" strokeWidth="2" transform="rotate(-7 30 42)" />
      <text x="27" y="49" textAnchor="middle" fontSize="17" fontWeight="700" fill={GREEN} fontFamily="monospace" transform="rotate(-7 30 42)">
        Aa
      </text>
      <rect x="58" y="24" width="52" height="40" rx="9" fill="#ffffff" stroke={GREEN} strokeWidth="2" transform="rotate(6 84 44)" />
      <text x="84" y="51" textAnchor="middle" fontSize="17" fontWeight="700" fill="#0f766e" fontFamily="serif" transform="rotate(6 84 44)">
        词
      </text>
      <circle cx="102" cy="22" r="8" fill={GREEN} />
      <path d="M98.5 22l2.6 2.8 4.4-5.2" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ReadingArt() {
  return (
    <svg viewBox="0 0 120 84" className="h-full w-full" aria-hidden="true" role="presentation">
      <path d="M14 30c12-7 22-7 32 0 10-7 20-7 32 0v34c-12-6-22-6-32 0-10-6-20-6-32 0z" fill="#ffffff" stroke="#f0d9a8" strokeWidth="2" />
      <path d="M46 30v34" stroke="#f0d9a8" strokeWidth="2" />
      <path d="M22 41h16M22 50h16M54 41h16M54 50h16" stroke="#efe4cc" strokeWidth="3" strokeLinecap="round" />
      <circle cx="92" cy="48" r="13" fill="#ffffff" stroke={AMBER} strokeWidth="3" />
      <path d="M101 58l10 10" stroke={AMBER} strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function WritingArt() {
  return (
    <svg viewBox="0 0 120 84" className="h-full w-full" aria-hidden="true" role="presentation">
      <rect x="20" y="14" width="58" height="60" rx="8" fill="#ffffff" stroke="#d9d5f0" strokeWidth="2" />
      <path d="M31 28h36M31 39h36M31 50h24" stroke="#e4e1f4" strokeWidth="3" strokeLinecap="round" />
      <g transform="rotate(38 84 48)">
        <rect x="78" y="20" width="13" height="36" rx="3" fill={AMBER} />
        <path d="M78 56l6.5 10 6.5-10z" fill="#c2760a" />
      </g>
    </svg>
  );
}

/* ---------------- 配对四连卡片插画 ----------------
   四张图共用 120×84 画布和同一套配色，互相之间靠「形状语言」区分：
   消除＝成对的小方块，翻牌＝两张叠起来的牌，拼写＝键盘键帽，听音＝声波。
   不画具体单词，缩到 104px 高时也不糊。 */

export function BlastArt() {
  return (
    <svg viewBox="0 0 120 84" className="h-full w-full" aria-hidden="true" role="presentation">
      <rect x="12" y="14" width="40" height="24" rx="6" fill="#ffffff" stroke={BLUE} strokeWidth="2" />
      <text x="32" y="31" textAnchor="middle" fontSize="11" fontWeight="700" fill={BLUE} fontFamily="monospace">
        word
      </text>
      <rect x="68" y="14" width="40" height="24" rx="6" fill={BLUE_SOFT} stroke="#bcd4fb" strokeWidth="2" />
      <text x="88" y="31" textAnchor="middle" fontSize="11" fontWeight="700" fill="#2563eb" fontFamily="serif">
        单词
      </text>
      <path d="M52 26h16" stroke={BLUE} strokeWidth="2" strokeDasharray="3 3" />
      <rect x="12" y="46" width="40" height="24" rx="6" fill="#ffffff" stroke={AMBER} strokeWidth="2" />
      <rect x="68" y="46" width="40" height="24" rx="6" fill="#fdf3e3" stroke="#f6e2c0" strokeWidth="2" />
      <path d="M52 58h16" stroke={AMBER} strokeWidth="2" strokeDasharray="3 3" />
      <circle cx="60" cy="58" r="4.5" fill={GREEN} />
      <path d="M57.8 58l1.6 1.7 2.6-3" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MemoryArt() {
  return (
    <svg viewBox="0 0 120 84" className="h-full w-full" aria-hidden="true" role="presentation">
      <rect x="20" y="18" width="34" height="48" rx="7" fill="#ffffff" stroke="#bcd4fb" strokeWidth="2" transform="rotate(-9 37 42)" />
      <text x="37" y="48" textAnchor="middle" fontSize="15" fill="#bcd4fb" fontFamily="monospace" transform="rotate(-9 37 42)">
        ?
      </text>
      <rect x="48" y="16" width="34" height="48" rx="7" fill="#ffffff" stroke={BLUE} strokeWidth="2" transform="rotate(7 65 40)" />
      <text x="65" y="46" textAnchor="middle" fontSize="12" fontWeight="700" fill={BLUE} fontFamily="monospace" transform="rotate(7 65 40)">
        Aa
      </text>
      <rect x="76" y="20" width="34" height="48" rx="7" fill={BLUE_SOFT} stroke="#bcd4fb" strokeWidth="2" transform="rotate(-5 93 44)" />
      <text x="93" y="50" textAnchor="middle" fontSize="12" fontWeight="700" fill="#2563eb" fontFamily="serif" transform="rotate(-5 93 44)">
        词
      </text>
    </svg>
  );
}

export function SpellArt() {
  return (
    <svg viewBox="0 0 120 84" className="h-full w-full" aria-hidden="true" role="presentation">
      {[
        [18, 20],
        [44, 20],
        [70, 20],
        [26, 42],
        [52, 42],
        [78, 42],
      ].map(([x, y], i) => (
        <rect key={i} x={x} y={y} width="22" height="18" rx="5" fill="#ffffff" stroke={LINE} strokeWidth="1.8" />
      ))}
      <rect x="26" y="64" width="48" height="18" rx="5" fill={BLUE_SOFT} stroke="#bcd4fb" strokeWidth="1.8" />
      <text x="50" y="77" textAnchor="middle" fontSize="11" fontWeight="700" fill={BLUE} fontFamily="monospace">
        spell
      </text>
      <rect x="84" y="64" width="18" height="18" rx="5" fill={AMBER} stroke="#c2760a" strokeWidth="1.6" />
      <path d="M89 73h8" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function ListenArt() {
  return (
    <svg viewBox="0 0 120 84" className="h-full w-full" aria-hidden="true" role="presentation">
      <path d="M26 36h9l12-11v34l-12-11h-9z" fill="#ffffff" stroke={BLUE} strokeWidth="2" strokeLinejoin="round" />
      <path d="M56 30a15 15 0 0 1 0 24" fill="none" stroke={BLUE} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M66 22a26 26 0 0 1 0 40" fill="none" stroke="#9dc0fb" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M76 15a36 36 0 0 1 0 54" fill="none" stroke="#cfe0fd" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="94" cy="24" r="9" fill={AMBER} opacity="0.9" />
      <text x="94" y="28" textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff" fontFamily="monospace">
        A
      </text>
    </svg>
  );
}

/* ---------------- 进阶挑战卡片插画 ----------------
   与配对四连同一画布（120×84）、同一配色，继续用「形状语言」区分玩法。 */

export function BlastLevelsArt() {
  return (
    <svg viewBox="0 0 120 84" className="h-full w-full" aria-hidden="true" role="presentation">
      {[0, 1, 2].map((row) =>
        [0, 1, 2, 3].map((col) => (
          <rect
            key={`${row}-${col}`}
            x={12 + col * 25}
            y={12 + row * 20}
            width="20"
            height="15"
            rx="4"
            fill={(row + col) % 2 === 0 ? "#ffffff" : BLUE_SOFT}
            stroke={(row + col) % 2 === 0 ? "#bcd4fb" : "#cdd9f5"}
            strokeWidth="1.6"
          />
        )),
      )}
      <rect x="87" y="52" width="21" height="22" rx="5" fill="#fdf3e3" stroke={AMBER} strokeWidth="2" />
      <text x="97" y="68" textAnchor="middle" fontSize="11" fill="#c2760a" fontFamily="monospace">
        🔒
      </text>
    </svg>
  );
}

export function SentenceArt() {
  return (
    <svg viewBox="0 0 120 84" className="h-full w-full" aria-hidden="true" role="presentation">
      <rect x="10" y="16" width="44" height="20" rx="7" fill="#ffffff" stroke={BLUE} strokeWidth="2" />
      <text x="32" y="31" textAnchor="middle" fontSize="11" fontWeight="700" fill={BLUE} fontFamily="monospace">
        The
      </text>
      <rect x="60" y="16" width="48" height="20" rx="7" fill={BLUE_SOFT} stroke="#bcd4fb" strokeWidth="2" />
      <text x="84" y="31" textAnchor="middle" fontSize="11" fontWeight="700" fill="#2563eb" fontFamily="monospace">
        report
      </text>
      <rect x="24" y="44" width="44" height="20" rx="7" fill="#ffffff" stroke="#cdd9f5" strokeWidth="2" />
      <text x="46" y="59" textAnchor="middle" fontSize="11" fontWeight="700" fill="#9db2c4" fontFamily="monospace">
        suggests
      </text>
      <rect x="74" y="44" width="34" height="20" rx="7" fill="#ffffff" stroke={AMBER} strokeWidth="2" />
      <text x="91" y="59" textAnchor="middle" fontSize="11" fontWeight="700" fill="#c2760a" fontFamily="monospace">
        that
      </text>
    </svg>
  );
}

export function FlappyArt() {
  return (
    <svg viewBox="0 0 120 84" className="h-full w-full" aria-hidden="true" role="presentation">
      <rect x="14" y="0" width="20" height="30" rx="3" fill="#7bb661" />
      <rect x="14" y="58" width="20" height="26" rx="3" fill="#7bb661" />
      <circle cx="64" cy="42" r="12" fill="#f4b942" stroke="#e8842c" strokeWidth="2" />
      <circle cx="69" cy="38" r="3" fill="#fff" />
      <circle cx="70" cy="38" r="1.5" fill="#333" />
      <path d="M75 42l8 2-8 4z" fill="#e8842c" />
      <path d="M88 20a18 18 0 0 1 0 44" fill="none" stroke="#bcd4fb" strokeWidth="2" strokeLinecap="round" />
      <path d="M98 12a30 30 0 0 1 0 60" fill="none" stroke="#dfe8fb" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function MoleArt() {
  return (
    <svg viewBox="0 0 120 84" className="h-full w-full" aria-hidden="true" role="presentation">
      <ellipse cx="40" cy="62" rx="22" ry="8" fill="#dfe3ea" />
      <circle cx="40" cy="46" r="15" fill="#8d6e4f" />
      <circle cx="35" cy="43" r="2.4" fill="#fff" />
      <circle cx="45" cy="43" r="2.4" fill="#fff" />
      <ellipse cx="40" cy="52" rx="4" ry="3" fill="#6d523a" />
      <rect x="66" y="26" width="40" height="18" rx="5" fill={BLUE_SOFT} stroke="#bcd4fb" strokeWidth="2" />
      <text x="86" y="40" textAnchor="middle" fontSize="10" fontWeight="700" fill="#2563eb" fontFamily="monospace">
        government
      </text>
      <path d="M86 50v14" stroke={AMBER} strokeWidth="2" strokeDasharray="3 3" />
      <path d="M78 66l8-8 8 8" fill="none" stroke={AMBER} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function GuardArt() {
  return (
    <svg viewBox="0 0 120 84" className="h-full w-full" aria-hidden="true" role="presentation">
      <rect x="0" y="0" width="120" height="84" rx="8" fill="#10142a" />
      <circle cx="82" cy="26" r="11" fill="#e07a3f" stroke="rgba(255,180,90,.8)" strokeWidth="2" />
      <text x="82" y="30" textAnchor="middle" fontSize="8" fontWeight="700" fill="#fff" fontFamily="monospace">
        adapt
      </text>
      <path d="M70 36l-12 12M78 38l-8 10" stroke="rgba(255,180,90,.55)" strokeWidth="2" strokeLinecap="round" />
      <rect x="18" y="58" width="16" height="18" fill="#3d5a80" />
      <rect x="38" y="50" width="16" height="26" fill="#3d5a80" />
      <rect x="58" y="60" width="16" height="16" fill="#3d5a80" />
      <text x="47" y="44" textAnchor="middle" fontSize="8" fill="#9db2c4" fontFamily="monospace">
        「适应」
      </text>
    </svg>
  );
}

export function SprintArt() {
  return (
    <svg viewBox="0 0 120 84" className="h-full w-full" aria-hidden="true" role="presentation">
      <path d="M52 8l-16 30h13l-6 24 22-32H52l8-22z" fill={AMBER} stroke="#c2760a" strokeWidth="1.6" strokeLinejoin="round" />
      <rect x="72" y="18" width="34" height="14" rx="4" fill="#ffffff" stroke="#cdd9f5" strokeWidth="1.8" />
      <rect x="72" y="38" width="34" height="14" rx="4" fill={BLUE_SOFT} stroke="#bcd4fb" strokeWidth="1.8" />
      <rect x="72" y="58" width="34" height="14" rx="4" fill="#ffffff" stroke="#cdd9f5" strokeWidth="1.8" />
      <path d="M20 40h24M14 40h-2M18 32h-4M18 48h-4" stroke={BLUE} strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function SnakeArt() {
  return (
    <svg viewBox="0 0 120 84" className="h-full w-full" aria-hidden="true" role="presentation">
      <rect x="8" y="8" width="104" height="68" rx="8" fill="#eef4e8" stroke="#d8e4cd" strokeWidth="2" />
      <path d="M20 62h34v-20h24v-20h22" fill="none" stroke="#4e9a3d" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="102" cy="22" r="9" fill="#f4b942" />
      <text x="102" y="26" textAnchor="middle" fontSize="8" fontWeight="700" fill="#333" fontFamily="monospace">
        aim
      </text>
      <circle cx="30" cy="24" r="8" fill="#9db2c4" />
      <text x="30" y="27" textAnchor="middle" fontSize="7" fontWeight="700" fill="#333" fontFamily="monospace">
        idea
      </text>
    </svg>
  );
}

/* ---------------- 掌握度里程碑：路径 + 五个关卡点 ---------------- */

const MILESTONES = [
  { label: "起步", need: 0 },
  { label: "入门", need: 25 },
  { label: "上手", need: 50 },
  { label: "熟练", need: 75 },
  { label: "通关", need: 100 },
];

// 五个点落在一条起伏的路径上，坐标写死，不做布局计算 —— 省得小屏下点挤成一坨
const XS = [36, 148, 260, 372, 484];
const YS = [74, 44, 70, 40, 66];

export function MilestonePath({ pct }: { pct: number }) {
  const reached = MILESTONES.filter((m) => pct >= m.need).length;
  const currentIndex = Math.min(reached, MILESTONES.length - 1);

  return (
    <svg viewBox="0 0 520 116" className="h-full w-full" role="img" aria-label={`掌握度里程碑，已点亮 ${reached} / 5 关`}>
      <path
        d="M36 74C88 74 96 44 148 44S212 70 260 70 320 40 372 40 428 66 484 66"
        fill="none"
        stroke={LINE}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="1 8"
      />
      {MILESTONES.map((m, i) => {
        const done = pct >= m.need;
        const isCurrent = i === currentIndex && !done;
        return (
          <g key={m.label}>
            {isCurrent && <circle cx={XS[i]} cy={YS[i]} r="19" fill={BLUE} opacity="0.14" />}
            <circle
              cx={XS[i]}
              cy={YS[i]}
              r={isCurrent ? 13 : 11}
              fill={done ? BLUE : isCurrent ? "#ffffff" : "#f2f4f8"}
              stroke={done ? BLUE : isCurrent ? BLUE : LINE}
              strokeWidth={isCurrent ? 3 : 2}
            />
            {done ? (
              <path
                d={`M${XS[i] - 4.5} ${YS[i]}l3.4 3.6 7-7.4`}
                stroke="#ffffff"
                strokeWidth="2.6"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : (
              <circle cx={XS[i]} cy={YS[i]} r="3.4" fill={isCurrent ? BLUE : "#cfd6e2"} />
            )}
            <text
              x={XS[i]}
              y={YS[i] + 32}
              textAnchor="middle"
              fontSize="10.5"
              fill={done ? BLUE : "#98a2b3"}
              fontFamily="inherit"
              fontWeight={isCurrent ? 600 : 400}
            >
              {m.label}
            </text>
            <text x={XS[i]} y={YS[i] + 45} textAnchor="middle" fontSize="9" fill="#b6bfcd" fontFamily="monospace">
              {m.need}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * 里程碑的小屏版本。
 *
 * 为什么不用上面那张 SVG：SVG 按宽度等比缩放，520 的 viewBox 塞进 390 宽的手机后
 * 10.5px 的刻度字只剩 6px 上下，看着像一排灰点 —— 等于没写。小屏改成 HTML 排布，
 * 字号是真实像素，怎么缩都读得清；桌面再换回那条起伏的路径，形状更好看。
 */
export function MilestoneRow({ pct }: { pct: number }) {
  const reached = MILESTONES.filter((m) => pct >= m.need).length;
  return (
    <div className="relative pt-1">
      <span
        className="absolute top-[13px] right-[9%] left-[9%] h-[2px] bg-[#eef1f6]"
        aria-hidden="true"
      />
      <ol className="relative flex items-start justify-between" aria-label={`掌握度里程碑，已点亮 ${reached} / 5 关`}>
        {MILESTONES.map((m, i) => {
          const done = pct >= m.need;
          const isCurrent = i === reached && !done;
          return (
            <li key={m.label} className="flex w-[19%] min-w-0 flex-col items-center">
              <span
                className="flex h-[26px] w-[26px] items-center justify-center rounded-full border-2"
                style={{
                  background: done ? BLUE : isCurrent ? "#ffffff" : "#f2f4f8",
                  borderColor: done || isCurrent ? BLUE : LINE,
                  boxShadow: isCurrent ? "0 0 0 4px rgba(56,130,246,0.14)" : undefined,
                }}
              >
                {done ? (
                  <svg viewBox="0 0 16 16" className="h-[13px] w-[13px]" aria-hidden="true">
                    <path d="M3.5 8.4l3 3.2 6-6.6" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <span
                    className="h-[6px] w-[6px] rounded-full"
                    style={{ background: isCurrent ? BLUE : "#cfd6e2" }}
                  />
                )}
              </span>
              <span
                className="mt-1.5 text-[11px] leading-none"
                style={{ color: done ? BLUE : "#98a2b3", fontWeight: isCurrent ? 600 : 400 }}
              >
                {m.label}
              </span>
              <span className="mt-1 font-mono text-[10px] leading-none text-[#b6bfcd]">{m.need}%</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ---------------- 小徽章图标（生词本 / 排行 / 错题） ---------------- */
export function BadgeIcon({ kind }: { kind: "book" | "rank" | "wrong" }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: "1.9", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden="true">
      {kind === "book" && (
        <g {...common}>
          <path d="M4 5.5C4 4.7 4.7 4 5.5 4H11v15H5.5A1.5 1.5 0 0 1 4 17.5z" />
          <path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H13v15h5.5a1.5 1.5 0 0 0 1.5-1.5z" />
        </g>
      )}
      {kind === "rank" && (
        <g {...common}>
          <path d="M4 20h16" />
          <rect x="5" y="12" width="4" height="6" rx="1" />
          <rect x="10.5" y="7" width="4" height="11" rx="1" />
          <rect x="16" y="10" width="4" height="8" rx="1" />
        </g>
      )}
      {kind === "wrong" && (
        <g {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M9 9l6 6M15 9l-6 6" />
        </g>
      )}
    </svg>
  );
}

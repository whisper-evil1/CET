# -*- coding: utf-8 -*-
"""生成 CET 阅读刷题站作品介绍文档（去 AI 味版本）。"""
from docx import Document
from docx.shared import Pt, RGBColor, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn

doc = Document()

# 基础样式：中文宋体，英文 Calibri，正文 11pt
style = doc.styles['Normal']
style.font.name = 'Calibri'
style.font.size = Pt(11)
style.element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')


def set_cn_font(run, name='宋体', size=11, bold=False, color=None):
    run.font.name = 'Calibri'
    run.font.size = Pt(size)
    run.font.bold = bold
    run._element.rPr.rFonts.set(qn('w:eastAsia'), name)
    if color:
        run.font.color.rgb = color


def h1(text):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    r = p.add_run(text)
    set_cn_font(r, '微软雅黑', 16, True)
    p.paragraph_format.space_before = Pt(18)
    p.paragraph_format.space_after = Pt(8)
    return p


def h2(text):
    p = doc.add_paragraph()
    r = p.add_run(text)
    set_cn_font(r, '微软雅黑', 13, True, RGBColor(0x1F, 0x3A, 0x5F))
    p.paragraph_format.space_before = Pt(12)
    p.paragraph_format.space_after = Pt(4)
    return p


def body(text, indent=False):
    p = doc.add_paragraph()
    r = p.add_run(text)
    set_cn_font(r, '宋体', 11)
    p.paragraph_format.line_spacing = 1.5
    p.paragraph_format.space_after = Pt(4)
    if indent:
        p.paragraph_format.first_line_indent = Pt(22)
    return p


def kv(label, value):
    p = doc.add_paragraph()
    r1 = p.add_run(label)
    set_cn_font(r1, '宋体', 11, True)
    r2 = p.add_run(value)
    set_cn_font(r2, '宋体', 11)
    p.paragraph_format.space_after = Pt(2)
    return p


def bullet(text):
    p = doc.add_paragraph(style='List Bullet')
    r = p.add_run(text)
    set_cn_font(r, '宋体', 11)
    p.paragraph_format.space_after = Pt(2)
    return p


def numbered(text):
    p = doc.add_paragraph(style='List Number')
    r = p.add_run(text)
    set_cn_font(r, '宋体', 11)
    p.paragraph_format.space_after = Pt(2)
    return p


def img_placeholder(caption):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(f'［此处插入截图：{caption}］')
    set_cn_font(r, '宋体', 10, False, RGBColor(0x88, 0x88, 0x88))
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(6)


# ===== 封面标题 =====
title = doc.add_paragraph()
title.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = title.add_run('CET 阅读刷题站')
set_cn_font(r, '微软雅黑', 22, True)
title.paragraph_format.space_after = Pt(2)

sub = doc.add_paragraph()
sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = sub.add_run('作品介绍文档')
set_cn_font(r, '微软雅黑', 14, False, RGBColor(0x55, 0x55, 0x55))
sub.paragraph_format.space_after = Pt(16)

# 信息行
kv('项目类型：', 'Web 应用（浏览器访问，无需安装）')
kv('线上地址：', 'https://cet-reading-82947.app.workbuddy.host/?sharecode=XRRLK7HGZP')
kv('源码仓库：', 'GitHub  whisper-evil1/CET')
kv('技术栈：', 'Next.js 15 + React 19 + TypeScript + Prisma + SQLite + NextAuth v5')

# ===== 一、项目详情及使用方式 =====
h1('一、项目详情及使用方式')

body('面向大学英语四六级（CET-4/6）备考人群，把刷阅读题做成一个完整闭环：做题、查词、收错题、攒生词、问 AI。'
     '不堆功能，每个模块都为备考实际流程服务。')

h2('使用方式')
numbered('打开线上链接，注册一个账号（邮箱 + 密码，项目自带注册接口）。')
numbered('首页选 CET4 或 CET6 试卷进入练习。')
numbered('练习页左右双栏：左边文章、右边题目，两栏各自滚动，互不影响。')
numbered('文章里点任意词查释义，可直接加入生词本。')
numbered('选答案、提交，看逐项解析和原文依据句。')
numbered('错题一键收藏，进个人中心复盘。')
numbered('顶部“问 AI”打开抽屉，针对当前题目提问，回答逐字流式输出。')
numbered('生词本分三层：词表（搜索复习）、刷词（认识 / 不认识卡片）、随身听（Web Speech 朗读连播）。')

img_placeholder('首页试卷列表（CET4 / CET6 两套演示卷）')

# ===== 二、项目亮点 =====
h1('二、项目亮点')

h2('1. 双栏独立滚动')
body('左文右题是阅读刷题最该有的样子，但很多刷题站把文章和题目挤在一栏。'
     '这个项目让两栏 scrollTop 互不干扰，长文章读到哪、题就答到哪，不用来回滚。')

h2('2. 查词四级链路')
body('点一个词，按顺序找释义：本地缓存 → 内置词库 → ecdict 离线词库（14930 词）→ AI（DeepSeek）→ '
     '兜底空释义也能先收进生词本。四级兜底保证查词命中率，不因词库缺词卡住。')

h2('3. 词形还原增强')
body('“researchers” 这种词，简单去 s 得到 “researcher” 还是查不到（词库只有 research）。'
     '项目做了递归两层后缀剥离 + CVC 双写辅音还原（admitted → admit），把变形词还原到词库能命中的原形。')

h2('4. 生词本三层结构')
body('词表看全量、刷词做卡片判断、随身听用浏览器 Web Speech API 朗读连播。'
     '一个生词本覆盖“认、记、听”三个环节，不是只存个列表。')

h2('5. AI 答疑接云 LLM')
body('原来没 API Key 走 mock，后来接 WorkBuddy 云服务 LLM 模块，前端直调，免密钥，33 个模型可选，流式输出。'
     '云模型不可用时自动回退服务端演示流式，不白屏。')

h2('6. 完整备考闭环')
body('刷题、错题、生词、答疑四件事在一个站里打通，不是东拼西凑。')

img_placeholder('练习页双栏（左文章右题目，点词查词弹卡）')

# ===== 三、AI 测试技术落地使用情况 =====
h1('三、AI 测试技术落地使用情况概述')
body('项目里 AI 落地在三处：')

h2('1. AI 答疑（核心）')
bullet('接入方式：WorkBuddy cloud-service 的 LLM 模块，前端用 @tencent-ai/workbuddy-cloud-sdk 直调 '
       'cloud.llm.chat.completions.create，stream 流式。')
bullet('免密钥：走应用配额（creator quota），终端用户不用自己的 Key。')
bullet('模型：云服务提供 33 个可用模型，默认用 auto 自动路由。')
bullet('上下文：新增 GET /api/questions/[id]/ai-context 服务端接口，鉴权后查数据库拼系统提示词'
       '（含文章原文、题干、我的作答）返回前端，前端拿这个 prompt 去调云 LLM。'
       '数据库读取留在服务端，模型调用留在前端，符合云 LLM 文档“禁止 Node BFF 代理调模型”的约束。')
bullet('验证：node + SDK 直调云 LLM，问“用一句话介绍大学英语四六级考试”，模型流式返回真实回答（79 字）。')
bullet('限流：ai-context 接口按用户 40 次 / 10 分钟限流，防刷额度。')
bullet('降级：云模型不可用时，抽屉自动回退服务端演示流式，保证可用。')

h2('2. AI 查词兜底')
bullet('查词四级链路最后一环是 AI（DeepSeek，OpenAI 兼容接口），词库都没命中时调 AI 生成释义。')
bullet('没 Key 时走空释义兜底，词照样能收进生词本，标 needsDefinition，后续可补全。')

h2('3. 词形还原（规则算法，非 AI）')
body('严格说不是 AI，但是查词链路能命中词库的关键：递归后缀剥离 + CVC 双写辅音还原。')

body('AI 测试角度：项目验证了“前端直调云 LLM + 服务端只给上下文”这种架构可行，'
     '云 LLM 的 Origin 校验、配额、模型路由、流式都跑通了。', indent=True)

img_placeholder('AI 答疑抽屉（流式输出，顶部“云模型已接入”标识）')

# ===== 四、关键技术 =====
h1('四、项目中涉及的关键技术')

bullet('前端：Next.js 15.5 + React 19 + TypeScript（strict 模式）+ Tailwind v4。')
bullet('数据层：Prisma 6.16 + SQLite（schema 与 Postgres 兼容，可平滑迁移）。')
bullet('认证：NextAuth v5 Credentials + bcrypt + JWT session。')
bullet('词库：ecdict 离线词库（14930 词，2.2MB，懒加载进内存 Map）+ 内置词库。')
bullet('AI：WorkBuddy cloud-service LLM 模块（@tencent-ai/workbuddy-cloud-sdk，免密钥，33 模型）'
       '+ DeepSeek（OpenAI 兼容，查词兜底）。')
bullet('朗读：Web Speech API（SpeechSynthesis），随身听连播。')
bullet('部署：WorkBuddy sites（Node 单端口，线上 verified）。')
bullet('状态管理：zustand。')

# ===== 五、项目相关图片 =====
h1('五、项目相关的图片 / 照片')
body('建议插入以下截图（位置已在对应章节标注）：')
numbered('首页试卷列表（CET4 / CET6 两套演示卷）。')
numbered('练习页双栏（左文章右题目，点词查词弹卡）。')
numbered('AI 答疑抽屉（流式输出，顶部“云模型已接入”标识）。')
numbered('生词本三层（词表 / 刷词卡片 / 随身听）。')
numbered('错题收藏 / 个人中心。')
body('说明：以上截图需在线上环境登录后截取，文档定稿时补入。')

img_placeholder('生词本三层（词表 / 刷词卡片 / 随身听）')

# ===== 六、发表 / 获奖情况 =====
h1('六、项目之前是否发表过或获奖')
body('否。本项目为新开发，未公开发表，未参加其他评比，未获奖。')

# ===== 七、是否在他人项目基础上优化 =====
h1('七、是否在他人项目基础上优化')
body('否。项目从零开发，基于自己的 Prisma schema、自己的组件、自己的种子数据。'
     '没用任何现成模板或他人项目作为基础。')

# 保存
out = r'D:\Workspace\trae\CET\CET\作品介绍文档.docx'
doc.save(out)
print('saved:', out)

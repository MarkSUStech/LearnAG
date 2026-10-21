---
name: LearnAgent 研习记录台预览
description: 暖白阅读面、墨色文字与赤陶色操作的个人学习工作台。
colors:
  desk: "#f7f6f2"
  paper: "#fffefa"
  mineral: "#eeede7"
  seam: "#dedfd7"
  ink: "#272e29"
  ink-secondary: "#61695f"
  ink-muted: "#747b71"
  terracotta: "#994e2c"
  terracotta-wash: "#f1e7dd"
  mastered: "#44725c"
  learning: "#9c632b"
  danger: "#ac3f39"
  navigation: "#eeefe9"
  dark-desk: "#1c221f"
  dark-paper: "#222a25"
  dark-mineral: "#2c352e"
  dark-seam: "#3b463e"
  dark-ink: "#e2e7de"
  dark-ink-secondary: "#b8c0b5"
  dark-ink-muted: "#a2ad9e"
  dark-accent: "#edb58b"
  dark-accent-wash: "#3f342a"
  dark-mastered: "#a3c4a9"
  dark-learning: "#d9af70"
  dark-navigation: "#19201b"
typography:
  display:
    fontFamily: "'Studio Noto Sans SC', 'Noto Sans SC', 'Microsoft YaHei', sans-serif"
    fontSize: "30px"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "-1px"
  display-mobile:
    fontFamily: "'Studio Noto Sans SC', 'Noto Sans SC', 'Microsoft YaHei', sans-serif"
    fontSize: "27px"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "-1px"
  ai-display:
    fontFamily: "'Studio Noto Sans SC', 'Noto Sans SC', 'Microsoft YaHei', sans-serif"
    fontSize: "22px"
    fontWeight: 550
    lineHeight: 1.65
    letterSpacing: "-0.65px"
  page-title:
    fontFamily: "'Studio Noto Sans SC', 'Noto Sans SC', 'Microsoft YaHei', sans-serif"
    fontSize: "27px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "-0.7px"
  heading:
    fontFamily: "'Segoe UI Variable', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "-0.4px"
  body:
    fontFamily: "'Segoe UI Variable', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.95
  interface:
    fontFamily: "'Segoe UI Variable', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "'Segoe UI Variable', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.5
  source:
    fontFamily: "'Cascadia Code', Consolas, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.9
rounded:
  inset: "3px"
  tag: "4px"
  small-control: "5px"
  control: "6px"
  navigation: "7px"
  message: "8px"
  content: "9px"
  figure: "10px"
  dialog: "12px"
spacing:
  compact: "4px"
  inline: "8px"
  control: "12px"
  section: "16px"
  group: "20px"
  block: "24px"
  chapter: "32px"
components:
  button-primary:
    backgroundColor: "{colors.terracotta}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "9px 13px"
  button-text:
    textColor: "{colors.terracotta}"
    padding: "3px"
  button-icon:
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.small-control}"
    width: "29px"
    height: "29px"
  navigation-item:
    textColor: "{colors.ink-secondary}"
    typography: "{typography.interface}"
    rounded: "{rounded.navigation}"
    padding: "10px 12px"
  navigation-item-selected:
    backgroundColor: "{colors.terracotta-wash}"
    textColor: "{colors.terracotta}"
    rounded: "{rounded.navigation}"
    padding: "10px 12px"
  topic-tag:
    backgroundColor: "{colors.mineral}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.tag}"
    padding: "2px 8px"
  compose-field:
    backgroundColor: "{colors.desk}"
    textColor: "{colors.ink}"
    rounded: "{rounded.content}"
    padding: "11px"
  material-scope:
    backgroundColor: "{colors.desk}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  reading-switch:
    backgroundColor: "{colors.mineral}"
    rounded: "{rounded.small-control}"
    padding: "2px"
  reading-switch-selected:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.inset}"
    padding: "3px 9px"
  swap-walkthrough:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.figure}"
    padding: "17px 20px 12px"
  quiz-feedback:
    textColor: "{colors.ink}"
    rounded: "{rounded.small-control}"
    padding: "10px 14px"
---

# Design System: LearnAgent 研习记录台预览

## Overview

**Creative North Star: "研习记录台"**

暖白纸面承载长篇理解，矿物灰绿组织工作区，墨色文字建立阅读层次，赤陶色标记可执行的下一步。整体像一张持续使用的研习记录台：精确、安静，内容和操作都能清楚定位。

本系统记录已实现的 `?design=workspace` 交互初稿，只约束 `src/design-preview/` 内的预览世界。正式应用仍保留 `src/styles/tokens.css` 的既有系统；本文不声明替换其根级设计令牌。设置中的“批注阅读室”和“专注研究台”是探索外观，尚未成为品牌承诺；亮暗阅读状态属于本预览已实现的能力。

**Key Characteristics:**

- 暖白纸面与矿物中性色，细线划分相邻区域。
- 中文展示字形与系统正文字体分工明确。
- 小面积赤陶色操作、柔和的选中底色和可识别的状态文字。
- 低起伏内容面，模态与临时反馈才使用明显阴影。
- 长文、公式和交互知识块共享阅读节奏。

## Colors

前置令牌是实际 CSS 的取值；名称描述用途，不额外建立未实现的色阶。

### Primary

- **Terracotta / 赤陶**：主要操作、当前导航、交互步骤和键盘焦点。**Terracotta Wash / 赤陶浅底**承载选中状态。
- 暗色状态以 **Dark Accent / 杏陶色**及其浅层背景承担相同职责。

### Secondary

- **Mastered / 掌握绿**：已连接、正确结果、完成的排序状态。
- **Learning / 学习赭色**：需要继续理解的结果反馈。
- **Danger / 提示红**：错误语义和 PDF 文件标识；暗色样式未重定义此值，当前沿用基础令牌。

### Neutral

- **Desk / 桌面**：阅读区与输入框的暖白灰底。**Paper / 纸面**：工具栏、协作面板及交互内容面；对应预览中的 panel 与 reading-paper 同值。
- **Mineral / 矿物浅灰**：标签、数组单元、用户消息、切换控件底层。
- **Seam / 接缝**：相邻工作区、列表与控件的细边界。
- **Ink / 墨色**：主要阅读文字；**Ink Secondary**用于说明和辅助操作；**Ink Muted**用于次级图标和状态点。
- **Navigation / 导航灰绿**：导航的独立底面。`dark-*` 是已实现的暗色对应项，不是附加装饰色。

**The Scoped Palette Rule.** 预览配色必须在预览容器内解析；不要把它写成正式应用的全局根变量。

**The Action Accent Rule.** 赤陶色用于动作、选择和焦点；正确与学习状态仍使用各自的语义色与文字。

## Typography

**Display Font:** 自托管 Studio Noto Sans SC，回退至 Noto Sans SC、Microsoft YaHei 与 sans-serif。

**Body Font:** Segoe UI Variable / Segoe UI / PingFang SC / Microsoft YaHei 系统栈。

**Source Font:** Cascadia Code / Consolas / monospace。

标题与 AI 引导标题采用本地展示字体，正文保持平台熟悉的阅读形态。展示文件是 Noto Sans SC 600 的有限子集（16,720 字节），使用 `font-display: swap`，许可及字形清单见 `src/design-preview/fonts/`。任意笔记标题中未包含的汉字会回退；不要把该子集描述为完整中文覆盖。

### Hierarchy

- **Display / 笔记标题**：使用 `display`；手机使用 `display-mobile`。标题是文章的第一行，阅读时间位于其后。
- **AI Display / 协作引导**：使用 `ai-display`；保留较舒展的行高和两行节奏。
- **Page Title / 资料页标题**：使用 `page-title`，手机缩至（25px）。
- **Heading / 正文小节**：使用 `heading`，手机缩至（18px）。
- **Body / 笔记正文**：使用 `body`；桌面字号可由设置调整（15–20px），当前默认（16px）。手机的正文规则固定为（15px）。
- **Interface / 工作区界面**：使用 `interface`；协作回答另用（12px，行高 1.9），紧凑标签使用 `label`。实际辅助字号从（9–13px）按位置定义，并非新增通用比例尺。
- **Source / Markdown 源码**：使用 `source`；手机缩至（12px）。

**The Display Ownership Rule.** 笔记大标题、协作引导和字标使用本地展示字形；长篇正文和正文小节保留系统字体栈。

前置令牌记录最终层叠结果：笔记标题的 CSS 字重为（650），AI 引导为（550），覆盖较早的（600）规则；本地字体文件本身仅提供（600）字形，其他字重按浏览器字体匹配处理。

## Layout

桌面以相邻区域构成工作台：导航（224px）、弹性阅读列、协作列（348px）。文章外框最大（748px），包含左右各（47px）内边距，因此可用正文宽度最多约（654px）；实际随中列收缩。阅读、导航、协作分别滚动，顶部工具栏和底部协作输入区保持定位。

- 宽屏从（1600px）起，导航与协作列变为（244px / 382px），文章外框最大（780px）。
- 在（1200px）及以下，侧列收至（200px / 310px），文章左右内边距收至（30px）。
- 在（1020px）及以下，协作面板改为右侧抽屉，宽度为（390px）与视口宽度的较小值。
- 在（700px）及以下，阅读区占满视口，导航改为（260px）左侧抽屉；文章左右内边距为（22px）。顶栏为（56px），文档栏为（46px）。
- 前置 spacing 记录反复使用的实际间距，并非要求所有布局遵循单一倍数；文章、控件和协作区有各自的密度。

**The Reading Measure Rule.** 阅读列保留最大宽度和居中内边距；空间不足时把辅助面板移入抽屉，不压缩为无法阅读的并排栏。

## Elevation & Depth

日常内容以色面和细接缝区分，交互演示、范围卡片和知识块不靠悬浮阴影建立层级。阴影仅出现在模态对话框、浮动通知和窄屏协作抽屉；具体值由 sidecar 的 `extensions.shadows` 保存。

**The Quiet Surface Rule.** 阅读内容保持平面；浮层用阴影说明暂时位于当前工作区之上。

## Shapes

短矩形与轻圆角构成主体。标签使用 `tag`，常规动作与范围卡片使用 `control`，导航使用 `navigation`，输入容器和 NoteUI 内容面使用 `content`，演示容器使用 `figure`，模态使用 `dialog`。边界通常为（1px）；头像、状态点和学习阶段编号可以使用圆形。

正确与待理解反馈使用完整的单线轮廓和淡语义底色。此规则针对反馈容器；它不禁止导航树、时间线或代码结构本身需要的结构线。

## Components

### Buttons

主要动作是紧凑、实心的赤陶色按钮，使用 `button-primary`。悬停以亮度（0.94）反馈，字重（550），字号（12px）。文本动作用赤陶色，图标动作为轻量方形容器。普通按钮悬停使用 Mineral，过渡为（160ms ease）；不可用状态不透明度为（0.42）。

键盘可达控件使用赤陶色轮廓（2px，偏移 3px）。协作输入框通过外容器的焦点边界显示编辑状态；发送按钮保持实心强调。

### Chips

话题标签是 Mineral 底色的静态分类标记，使用 `topic-tag`。协作意图是实际按钮，选中时使用 Terracotta Wash 与 Terracotta；不要把静态标签伪装成可操作入口。

### Cards / Containers

`material-scope` 持续显示当前材料，以 Desk 底色、单线边界和两级文字建立范围。`swap-walkthrough` 使用 Paper 底色与轻圆角；数字单元、累计代价、说明与步骤操作共享一块内容面。NoteUI 内容面在正文中使用（18px）内边距，手机为（13px）；协作消息中的知识块进一步收紧。

### Inputs / Fields

协作输入以 `compose-field` 的柔和底面和完整细边界组织文字、图片与发送动作。输入高度从（53px）开始，允许调整至（140px）；焦点进入时边界转为动作色。占位文字使用 Ink Secondary。搜索和筛选输入依所属容器建立边界，不强制统一为协作输入框。

### Navigation

导航行使用 `navigation-item`，当前项使用 `navigation-item-selected` 并保留明确的文本与 `aria-current`。阅读 / 源码切换使用 `reading-switch`，当前段以 Paper 底面浮出。协作标签通过文字与底部短线显示当前状态。手机以显式按钮打开抽屉，支持 Esc 关闭和可见焦点。

### Swap Walkthrough

数组变化、累计代价与文字说明同步推进；重置回到第一步，到达末步后禁用下一步。变化用短背景与边框过渡（200ms ease）呈现。数字采用等宽数字特性，说明使用实时播报。减少动画偏好关闭预览内过渡。

### Quiz Feedback

`quiz-feedback` 保持完整轮廓（1px），正确 / 待理解状态以 Mastered / Learning 与边界色混合，底色以语义色（6%）混入 Paper。正确标题与解释始终可见；状态不能只靠颜色表达。

## Do's and Don'ts

### Do:

- **Do** 保留暖白纸面、墨色层次与小面积赤陶色操作的关系。
- **Do** 在预览容器内使用令牌，维持正式应用与预览的样式边界。
- **Do** 让长文、公式和知识块共享阅读宽度，并让超长公式横向滚动。
- **Do** 保留当前材料范围、示例标记与实际执行状态，让视觉反馈说明真实行为。
- **Do** 为交互控件提供键盘焦点，并尊重减少动画偏好。

### Don't:

- **Don't** 把探索外观或本预览的布局直接声明为正式应用的新品牌标准。
- **Don't** 在文章大标题前重新加入重复的分类眉题；必要路径放在文档栏。
- **Don't** 给自测结果加粗彩色侧边条；使用完整细轮廓、文字和淡底色。
- **Don't** 宣称标题字库覆盖任意中文笔记，或把展示字体套用到整篇长文。
- **Don't** 用成功样式暗示已经调用模型、上传图片或写入真实文件；当前仅演示 AI 回复并在浏览器保存预览草稿。

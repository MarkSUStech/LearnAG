# IDE 语言服务器插件（LSP）

IDE 模式的智能提示由「语言服务器插件」提供，**全部在本机运行，编辑期不需要联网**。

## 工作方式

```
浏览器 Monaco 编辑器 ⇆ WebSocket(/api/lsp) ⇆ Node 后端 ⇆ 语言服务器子进程（stdio）
```

打开某种语言的文件时，后端自动启动对应的语言服务器进程，提供：

- 类型感知的自动补全（含自动导入，如 `date` → 自动补 `from datetime import date`）
- 悬停文档（类型签名 + docstring）
- 签名帮助（输入 `(` 提示参数）
- 实时诊断（红/黄波浪线，来源显示为插件名）
- 定义跳转（vault 内文件）

## 内置插件

| 插件 | 语言 | 状态 |
|---|---|---|
| Pyright | Python | **随项目内置**（`pyright` npm 依赖，无需本机安装 Python） |
| clangd | C / C++ | 需本机安装（winget install LLVM.LLVM） |
| gopls | Go | 需本机安装（go install golang.org/x/tools/gopls@latest） |
| rust-analyzer | Rust | 需本机安装（rustup component add rust-analyzer） |
| jdtls | Java | 需本机安装 |
| lua-language-server | Lua | 需本机安装 |

TS / JS / JSON / HTML / CSS 使用 Monaco 内置语言服务（tsserver 级别），不走插件通道。

安装好某个语言服务器后，重启 learn-agent 服务，状态栏的插头图标面板会显示「已安装」，打开对应语言文件即自动启用。

## 查看状态

IDE 模式状态栏右侧的插头图标（打开代码文件时出现）→ 插件面板，显示每个插件：运行中（绿点）/ 已安装待启动（灰点）/ 未检测到（红点 + 安装指引）。

## 添加 / 停用插件（可插拔）

编辑 `.learn-agent/lsp-plugins.json`（没有就新建），**无需改代码**：

```json
{
  "zig": {
    "name": "Zig Language Server",
    "languages": ["zig"],
    "command": "zls",
    "args": [],
    "installHint": "安装 zls 并加入 PATH"
  },
  "jdtls": null
}
```

说明：

- 键为插件 id；值置 `null` 表示停用该插件
- `languages` 为 Monaco 语言 id（与文件扩展名的映射见 `src/components/ide/fileIcons.ts`）
- `command` 从本机 PATH 解析；若插件随项目安装（如 pyright），加 `"bundled": true`，命令将解析到 `node_modules/.bin`
- 保存后刷新页面生效（内置插件状态有 1 分钟探测缓存）

注意：语言服务器的分析质量取决于对应语言生态（如 Pyright 需要 Python 环境才能解析第三方库的完整类型；本机未装 Python 时仍提供内置 typeshed 的标准库支持）。

## 编译 / 运行

打开可运行的代码文件时，标签栏右侧出现绿色 ▶ 按钮（快捷键 **Ctrl+Enter**），点击即在本机编译并运行：

- 运行前自动保存未落盘的修改
- 输出面板（编辑器下方）实时流式显示 stdout/stderr、编译与运行两个阶段、退出码
- 运行中可随时「停止」（Windows 下按进程树终止）；单次运行有 120s 硬超时
- 工作目录 = 文件所在目录

支持的语言与工具链探测顺序：

| 语言 | 探测的工具链 |
|---|---|
| Python | python → py -3 → python3 |
| JavaScript | node |
| TypeScript | node ≥22（--experimental-strip-types） |
| C | gcc → clang |
| C++ | g++ → clang++（-std=c++17） |
| Java | java ≥11（单文件源码启动） |
| Go | go run |
| Rust | rustc |

本机没有对应工具链时，▶ 按钮变为黄色；点击（或打开状态栏插头面板）可在「编译 / 运行工具链」区看到一键安装按钮（winget），安装过程流式输出在运行面板中，完成后自动重新探测。

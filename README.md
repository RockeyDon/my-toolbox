# 工具箱

供个人使用的 macOS 桌面应用。使用 Tauri 2、React、TypeScript 和 CodeMirror 6，包含字符工具和快捷命令。

## 开发

本机需安装 Node.js 22、pnpm 10、Rust 和 Xcode Command Line Tools。首期目标架构为 Apple Silicon（`aarch64-apple-darwin`）。

```sh
pnpm install --frozen-lockfile
make dev
```

仅开发网页界面时运行 `pnpm dev`，访问 `http://127.0.0.1:1420`。

## 使用

- **JSON格式化**：接受 JSON / JSON5（包括注释、单引号、尾随逗号和基础类型），也支持 Python 字典、列表、`True`、`False`、`None`、字符串转义、原始字符串和多行字符串；仅解析数据，不执行 Python 代码。字典键须为字符串，NaN 和 Infinity 明确报错。
- 格式化、转 Unicode、转中文均输出两空格缩进的多行标准 JSON，嵌套容器和相邻对象分行显示；仅点击“压缩”输出单行。字符串内部的标点和内容保持原意。手动编辑后保留高亮，重新格式化后才能继续转换。
- 多行 JSON 解析成功后，滚动时顶部固定显示已滚出视野的父级起始行，保留行号、缩进和颜色；点击或用 Tab 聚焦后按 Enter／空格可跳转。最多显示最近五级，且不超过编辑器高度的四分之一；编辑、压缩或解析失败时隐藏。
- 解析失败会尽力排版并提示行列位置，转换按钮保持禁用；尽力排版不负责修复语法。
- **长文本转换**：转义输出不带外围双引号的 JSON 字符串内容；展示按完整 JSON 转义规则还原。展示失败保留输入。

所有转换均在本机内存执行。切换 Tab 保留本次内容，退出或重新加载后清空；没有配置文件、数据库或网络服务。

- **快捷命令**：在同一输出标签中顺序执行并保留命令历史；繁忙标签将新命令排入可删除的队列。停止发送 Ctrl+C 对应的进程组中断信号。配置保存到 `~/Library/Application Support/com.rockeydon.toolbox/quick-commands.json`；队列、输出、标签与运行状态仅保存在内存，关闭标签或退出应用即清除。
- 快捷命令启动系统登录 Shell，以主目录作为初始工作目录，关闭标准输入，不提供交互式 TUI 或密码输入。命令具有本机用户权限；仅保存可信命令。不同标签可并行运行本机命令。
- 浏览器预览仅用于查看界面，不可加载桌面快捷命令配置或执行本机程序；本机 Shell 检测和命令执行需要 Tauri 桌面应用。

## 验证

```sh
make check
make test-unit
pnpm exec playwright install webkit
make test-e2e
```

`check` 检查 TypeScript、ESLint、Rust 格式与 Clippy。单元测试覆盖转换边界和 JSON 编辑器状态，端到端测试复用本机 Chrome 并使用 WebKit 验证交互。
若本机尚未安装 Chrome，可先运行 `pnpm exec playwright install chrome`；应用自身不依赖 Chrome。

## 构建和安装

```sh
make build
```

日常构建只生成 `src-tauri/target/release/bundle/macos/工具箱.app`，可直接打开，不创建或挂载 DMG。

需要拖拽安装包时单独运行：

```sh
make package
```

产物为 `src-tauri/target/release/bundle/dmg/工具箱_0.1.0_aarch64.dmg`。Tauri 制作 DMG 时可能短暂打开 Finder 窗口来设置安装布局，这是打包步骤。
静态检查、单元测试和界面测试均不制作安装包、不安装应用，也不会弹出安装窗口；手工验证安装流程不纳入常规回归测试。

打开 DMG，将“工具箱”拖入“应用程序”，或直接打开 `.app`。使用不依赖开发者证书的本机临时签名（ad hoc），未配置公证，仅用于本机，不发布 App Store。

图标源文件为 `artwork/toolbox.svg`。修改后运行 `pnpm icons` 重新生成 PNG、ICNS；生成资产已随工程提供，常规构建无需重新生成。

## 代码结构

- `src/features/characters/`：字符工具页面、JSON 状态机和独立转换函数。
- `src/features/quick-commands/`：快捷命令界面、输出与 ANSI 处理及内存会话状态。
- `src-tauri/src/quick_commands/`：快捷命令配置、Shell 发现和标签隔离的进程队列管理。
- `src/components/`：CodeMirror 编辑器适配组件。
- `src-tauri/`：桌面窗口、安全策略、图标和打包配置。

新增工具时增加对应功能目录与左侧菜单入口。字符工具仍不接入后端或持久化；快捷命令单独使用 Tauri 命令读写自己的本地 JSON 配置。

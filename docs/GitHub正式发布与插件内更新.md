# GitHub 正式发布与插件内更新

正式源：[chenjj2578459615-stack/kol-local-assistant](https://github.com/chenjj2578459615-stack/kol-local-assistant)。

## 用户使用

首次安装 0.2.1，或从 0.2.0 及更早版本迁移时，解压包并运行一次「安装或更新.cmd」。该脚本将插件及更新组件放在固定目录，并在当前 Windows 用户的 Chrome／Edge 注册更新组件；无需管理员权限。旧工作台点击「应用更新」后进入 0.2.1。新用户仍需首次手动加载一次插件目录。

此后全部在插件内完成：点击右上角「版本更新」→ 查看更新内容／检测更新 → 立即更新 → 自动回到新版。使用说明放在版本更新弹窗内。操作台、采集、平台登录继续在普通 Chrome 里完成。

自动检测间隔为 6 小时。发现正式新版可提醒；「下次再说」延后 24 小时；关闭「自动提醒正式新版」后，手动检测仍可用。正在采集时保留更新说明，但应用更新需要先暂停。

更新组件不是桌面操作台，不开窗口、不常驻、不创建开机启动项；Chrome 在需要查询组件状态或安装时启动它，完成后退出。当前分发包适用于 Windows；没有实现 macOS 的本机更新组件。

## 更新机制

1. 插件读取 GitHub `/repos/chenjj2578459615-stack/kol-local-assistant/releases/latest`。只采用正式 Release，拒绝草稿和预发布，不回退到开发包。匿名 API 限流时，转用 GitHub releases/latest 网页解析正式版本，减少共享网络下限流对更新的影响，不要求用户填写 GitHub Token。
2. 读取该 Release 的 `kol-update.json`，核对仓库、标签、版本、文件名和文件大小。更新说明与 Release 使用同一份 Markdown，界面按文字和列表显示，不执行远端 HTML 或脚本。
3. 用户点击立即更新前，保存当前草稿和任务。Chrome 通过 `com.kol.github_updater` 启动安装时配置的本机组件。采集中、已有更新进行中不接受重复安装。
4. 组件重新读取 GitHub 正式版本，下载 `KOL-Assistant-<版本>-windows.zip`，校验总大小、SHA-256 及包内各文件摘要，拒绝降级、路径越界、重复 ZIP 路径和不兼容新增权限。
5. 新文件放入 `extension/runtime/<版本>`，保留旧版目录及浏览器本地存储。清单与更新就绪标记完成后，插件保存状态并重载。失败保留旧版，错误原因与重试动作可见。

安装组件不接收任意下载地址、命令或安装目录，不读取浏览器 Cookie、用户资料或 AI Key。新辅助程序也在版本目录，避免覆盖正在运行的 EXE。没有使用从网络下载脚本并在扩展页面执行的方式。

## 每次发布

用户要求：**先给出更新内容，用户明确同意后再正式发布。** 开发完成不等于发布授权。

1. 更新版本号及 `releases/<版本>.md`，完成受影响的测试和安装包。
2. `npm run package` 生成中文本地包、GitHub ASCII 文件名包及 `kol-update.json`；更新说明来自同一份 Markdown。
3. `npm run release:prepare` 仅准备本地源码提交、安装包信息和审批材料，不推送、建 Release 或公开资产。
4. 将更新内容、安装包和验证结果给用户审查。用户未同意前保持未发布。
5. 明确获批后，执行 `npm run release:publish -- --approved-notes-sha256 <本次审批摘要>`。脚本核对说明、源码提交与 ZIP 未发生变化，再推送并创建正式 Release；不设置 prerelease，显式设为 latest。
6. 发布后核对 GitHub latest、版本、更新说明、资产大小与 SHA-256，并从插件实际检查能否检测该版。网络测试成功不等于其他用户已安装完成。

## 本轮验证

- 51 项单元测试，包括正式版筛选、版本比较、清单来源、提醒持久化、失败不重载和重复安装拦截。
- 独立 Chrome 真实 Native Messaging、真实 PowerShell 安装，以及测试用 GitHub 响应模拟的下一版安装：下载进度、摘要校验、ZIP 解包、目录切换、重载、草稿／批次／人工修改／提醒偏好保留；损坏包和断网均能报错，平台原标签页未刷新。
- 旧版 0.1.17 升级到当前版的任务、历史和列设置迁移验证通过。
- 原有工作台在 1440×900、1366×768、1280×720、1024×768、1280×600 布局通过。
- 当前尚未对外正式发布。GitHub 公网上真实下载当前版及其他用户设备安装，需要在审批后发布再验证。测试二进制的网络夹具只存在于隔离环境；正式二进制不包含该入口。

## Chrome 能力依据

- [非商店扩展安装限制](https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions?hl=en)：Windows／macOS 不能通过普通外部 update_URL 自动分发自托管 CRX，因此当前本地插件需要一次安装的本机写文件组件。
- [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging?hl=en)：按扩展 ID 允许的本机程序，通过标准输入输出通信。
- [Manifest V3 远程代码规则](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code?hl=en)：扩展自身不直接执行下载的远端代码；此方案由独立安装组件更新本地完整版本后再重载。

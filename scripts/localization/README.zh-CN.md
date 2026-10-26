# 简体中文汉化包

[English](README.md)

此工具针对 **Windows x64 的 pi-gui 1.0.1 发布版**，提供中文词库、汉化归档生成、
应用及恢复功能。这是本地界面文案补丁，不是应用内语言切换功能。其他版本或平台的
应用归档会因哈希不匹配而被拒绝。

已验证版本覆盖 508 条不同文案、682 处位置，包括导航、设置、服务商、模型、技能、
定时任务和常用操作。服务商及模型名称、用户内容、代码、后端提示和第三方扩展内容
不保证翻译。

## 使用方法

需要 Node.js 22.19 或更新版本。从源码使用时，先安装锁定的依赖：

```sh
npm ci --prefix scripts/localization --ignore-scripts --no-audit --no-fund
node scripts/localization/src/cli.mjs inspect "C:\path\to\pi-gui"
```

完全退出 pi-gui，然后应用中文：

```sh
node scripts/localization/src/cli.mjs apply "C:\path\to\pi-gui"
```

重新打开 pi-gui 即可使用中文。恢复英文时，先关闭应用，再执行：

```sh
node scripts/localization/src/cli.mjs restore "C:\path\to\pi-gui"
```

也可以使用 `Apply-Chinese.cmd` 或 `Restore-English.cmd`，将安装目录作为参数。
路径中有空格时需要加双引号。

## 打包分发

安装依赖后执行：

```sh
npm pack ./scripts/localization --ignore-scripts
```

生成的包包含 Acorn 解析器和许可证，解压后无需再次下载依赖。在解压后的
`package` 目录中执行 `node src/cli.mjs apply "安装目录"` 即可。
分发包不应包含应用安装程序、`app.asar`、用户目录、凭据或会话。

## 兼容性与恢复

- 工具校验原始归档、渲染脚本和汉化结果的 SHA-256，只接受已验证的 Windows 发布版。
- 原版保存在安装目录的 `localization/app.asar.en.original`，不会覆盖冲突的旧备份。
- 重复应用不会重复追加汉化内容；恢复英文会精确还原原版，并保留备份。
- 应用或恢复时必须完全退出 pi-gui，工具不会结束任何进程。操作期间不要启动应用或更新器。
- 应用更新可能覆盖汉化。新版本需要单独审查并生成匹配的配置，不能绕过哈希校验。

如只需离线生成单独的中文归档，可在任何受支持的 Node 平台执行：

```sh
node scripts/localization/src/cli.mjs build original-app.asar chinese-app.asar
```

输出文件必须尚不存在。此命令同样只接受已验证 Windows 版本的原始归档。

## 验证范围

执行 `npm --prefix scripts/localization test` 可验证归档完整性、错误版本拒绝、
备份保护、重复应用、精确恢复及模板字符转义。

工具生成的发布版归档已与本机实际验证过的中文归档逐字节匹配；Windows Electron
主界面、常规设置和服务商页面已显示中文。该验证不包含模型调用、账号登录、
macOS/Linux 应用或系统原生对话框。

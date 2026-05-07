# 智能防代签二维码签到系统

这是一个基于 Web 技术的智能签到系统，专为解决“扫码签到易被截图转发代签”的痛点而设计。支持高并发（100+人同时扫码），通过 Firebase 实现在线数据同步，并可通过 GitHub Pages 免费部署。

## 🌟 核心特性

- **防代签机制**：动态二维码每30秒自动刷新，包含时间戳 Token。旧二维码及转发的链接将会在短时间内（加上宽限期不超过45秒）自动失效。
- **高并发支持**：基于 Firebase Realtime Database 构建，并发读写性能极强，轻松应对上百人瞬间同时扫码提交的场景（无数据库锁冲突）。
- **设备防刷**：记录客户端 IP 及 User-Agent，并在本地写入设备防重签凭证。
- **Excel 互通**：支持直接导入包含“学号”、“姓名”的 Excel (.xlsx / .xls) 文件作为应到名单；签到结束后一键导出“缺勤名单”或“完整考勤记录” Excel。
- **纯前端架构**：完全通过 HTML/CSS/JS 实现，后端由 Serverless 的 Firebase 接管，**完美支持 GitHub Pages 零成本托管**。

## 🚀 部署指南 (GitHub Pages)

### 1. 配置 Firebase (免费后端)
1. 访问 [Firebase Console](https://console.firebase.google.com/)，登录 Google 账号。
2. 点击 **Create a project**（创建项目），命名为 `smart-signin`。
3. 进入项目后，在左侧菜单选择 **Build > Realtime Database**，点击 **Create Database**。
   - 位置选择推荐的默认位置。
   - 安全规则先选择 **Start in test mode**（测试模式），后续可以自行配置规则。
4. 返回项目概览页面，点击 **Web (</>)** 图标添加一个 Web 应用。
5. 注册应用后，你会得到一段 Firebase 配置代码（包含 `apiKey`, `databaseURL` 等）。请记录下这些信息。

### 2. 部署到 GitHub Pages
1. 在 GitHub 创建一个新的公开仓库（例如 `smart-checkin`）。
2. 将本项目的所有文件（`index.html`, `admin.html`, `checkin.html`, `css/`, `js/` 等）上传/推送到该仓库。
3. 在 GitHub 仓库页面，点击 **Settings** -> **Pages**。
4. 在 **Build and deployment** 下的 **Source** 选择 `Deploy from a branch`。
5. 在 **Branch** 栏位选择 `main`（或 `master`），文件夹选择 `/(root)`，点击 **Save**。
6. 等待几分钟，GitHub 会为你生成一个在线链接（如 `https://your-username.github.io/smart-checkin/`）。

### 3. 系统初始化
1. 访问你的 GitHub Pages 在线链接。
2. 点击 **教师管理端**，输入默认管理密码 `123456` 登录。
3. 首次进入系统时，会提示配置 Firebase。
4. 进入左侧的 **系统设置**，将你在第一步中获取的 `apiKey`, `authDomain`, `databaseURL`, `projectId` 填入对应的输入框。
5. 点击 **保存配置**，系统会自动重载。
6. 配置完成后，即可开始导入名单和发起签到！

## 📱 使用流程

1. **导入名单**：在“名单管理”上传班级 Excel 表格。
2. **发起签到**：在“签到管理”输入场次名称，点击开始。大屏幕展示动态二维码。
3. **学生扫码**：学生使用手机微信/浏览器扫描屏幕上的二维码，进入页面核对信息后提交。由于高并发架构，100人同时提交不会卡顿。
4. **实时监控**：教师端大屏实时显示应到、实到、未到人数及出勤率。
5. **结束与导出**：签到结束后，点击“导出缺勤名单”即可获取未到人员名单 Excel 文件。

## 🔒 隐私与安全
- 管理密码储存于浏览器的 LocalStorage 中，请不要在公共电脑上保存密码。
- 系统记录的数据均保存在你个人的 Firebase 数据库中，只有拥有管理员权限和 Firebase 密钥的你可以访问。

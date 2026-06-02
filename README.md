# AI 截屏 - Windows 桌面助手

一个轻量级的 Windows 桌面软件，截图后自动发送给 AI 处理，支持悬浮球、快捷键、自定义主题色等功能。

## ✨ 功能特性

- **智能截图**：支持全屏截图和区域截图
- **AI 集成**：截图后自动发送给 AI 分析（支持 DeepSeek、智谱 AI、通义千问等）
- **悬浮球界面**：最小化后显示悬浮球，始终置顶显示
- **快捷键支持**：可自定义截图快捷键
- **简洁界面**：现代化 UI，支持深色/浅色模式
- **自定义主题**：可自由选择主题色
- **低资源占用**：基于 Tauri 构建，安装包小，运行流畅

## 🚀 快速开始

### 环境要求
- Node.js 18+
- Rust 1.70+
- Windows 10/11

### 安装依赖
```bash
# 安装前端依赖
npm install

# 安装 Rust 工具链（如未安装）
# 从 https://rustup.rs/ 下载安装
```

### 开发运行
```bash
# 开发模式
npm run tauri dev

# 构建安装包
npm run tauri build
```

## 📦 项目结构

```
ai-screenshot/
├── src/                    # React 前端
│   ├── components/         # 组件
│   │   ├── MainWindow/     # 主窗口组件
│   │   ├── FloatBall/      # 悬浮球组件
│   │   └── Settings/       # 设置组件
│   ├── stores/            # 状态管理
│   ├── utils/             # 工具函数
│   └── styles/            # 样式文件
├── src-tauri/             # Rust 后端
│   ├── src/
│   │   ├── main.rs        # 主入口
│   │   ├── screenshot.rs  # 截图功能
│   │   ├── hotkey.rs      # 快捷键管理
│   │   └── window_manager.rs # 窗口管理
│   └── Cargo.toml         # Rust 依赖
└── package.json           # 前端依赖
```

## 🔧 配置说明

### AI 服务配置
1. 打开软件设置
2. 选择 AI 提供商（DeepSeek、智谱 AI、通义千问或自定义）
3. 输入 API Key 和模型名称
4. 保存配置即可使用

### 快捷键配置
默认快捷键：
- `Ctrl+Shift+1`：全屏截图
- `Ctrl+Shift+2`：区域截图  
- `Ctrl+Shift+``：显示/隐藏悬浮球

可在设置中自定义快捷键。

### 主题配置
- 支持自定义主题色
- 深色/浅色模式切换
- 悬浮球大小、透明度调节

## 🎯 使用场景

1. **学习辅助**：截图题目，AI 自动解答
2. **工作助手**：截图文档，AI 总结要点
3. **内容创作**：截图灵感，AI 生成文案
4. **日常使用**：快速截图分享，AI 智能分析

## 📝 开发计划

### 已完成
- [x] 项目基础架构搭建
- [x] 主窗口界面设计
- [x] 悬浮球组件实现
- [x] 状态管理系统
- [x] AI 服务集成
- [x] 设置面板

### 待完成
- [ ] Rust 后端截图功能完善
- [ ] 系统托盘功能
- [ ] 安装包制作
- [ ] 性能优化
- [ ] 错误处理完善

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 🙏 致谢

- [Tauri](https://tauri.app/) - 轻量级桌面应用框架
- [React](https://reactjs.org/) - 前端框架
- [Tailwind CSS](https://tailwindcss.com/) - CSS 框架
- 所有支持的 AI 服务提供商

---

**AI 截屏** - 让截图更智能，让学习更高效！
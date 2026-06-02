# AI截屏 - 开发指南

## 环境配置

### 1. 安装 Node.js 和 npm
- 下载地址: https://nodejs.org/
- 推荐版本: 18.x 或更高

### 2. 安装 Rust 工具链
```bash
# 使用 rustup 安装
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Windows 用户也可以从 https://rustup.rs/ 下载安装程序
```

### 3. 安装依赖
```bash
# 进入项目目录
cd ai-screenshot

# 安装前端依赖
npm install

# 安装 Tauri CLI（全局）
npm install -g @tauri-apps/cli
```

## 开发命令

### 开发模式
```bash
# 启动开发服务器
npm run dev

# 或使用 Tauri 开发模式
npm run tauri dev
```

### 构建应用
```bash
# 构建调试版本
npm run tauri build -- --debug

# 构建发布版本
npm run tauri build
```

### 其他命令
```bash
# 清理构建缓存
npm run clean

# 检查代码格式
npm run lint

# 类型检查
npm run type-check
```

## 项目结构说明

### 前端 (React + TypeScript)
- `src/components/`: React 组件
- `src/stores/`: Zustand 状态管理
- `src/utils/`: 工具函数
- `src/styles/`: 全局样式

### 后端 (Rust)
- `src-tauri/src/main.rs`: 主程序入口
- `src-tauri/src/screenshot.rs`: 截图功能
- `src-tauri/src/hotkey.rs`: 快捷键管理
- `src-tauri/src/window_manager.rs`: 窗口管理

### 配置文件
- `tauri.conf.json`: Tauri 应用配置
- `tailwind.config.js`: Tailwind CSS 配置
- `vite.config.ts`: Vite 构建配置

## 功能开发指南

### 1. 添加新组件
1. 在 `src/components/` 创建新目录
2. 创建组件文件 `ComponentName.tsx`
3. 导出组件并在需要的地方导入使用

### 2. 添加状态管理
1. 在 `src/stores/` 创建新的 store 文件
2. 使用 `zustand` 创建状态管理
3. 在其他组件中导入使用

### 3. 添加 Rust 功能
1. 在 `src-tauri/src/` 创建新的模块文件
2. 在 `main.rs` 中注册模块
3. 添加 Tauri 命令暴露给前端

### 4. 修改快捷键
1. 编辑 `src-tauri/src/hotkey.rs`
2. 注册新的全局快捷键
3. 在前端监听对应事件

## 调试技巧

### 前端调试
```javascript
// 使用 console.log
console.log('调试信息', data);

// 使用 React DevTools
// 安装 Chrome 扩展: React Developer Tools
```

### Rust 调试
```rust
// 使用 println! 输出日志
println!("调试信息: {:?}", data);

// 使用 log 库（推荐）
log::debug!("调试信息: {:?}", data);
```

### 错误处理
1. 前端错误: 查看浏览器控制台
2. Rust 错误: 查看命令行输出
3. Tauri 错误: 查看应用日志

## 打包发布

### Windows 安装包
```bash
# 构建 NSIS 安装包
npm run tauri build -- --target x86_64-pc-windows-msvc

# 输出位置: src-tauri/target/release/bundle/nsis/
```

### 配置说明
- 图标文件: `icons/` 目录
- 应用信息: `tauri.conf.json` 中的 `package` 和 `bundle` 配置
- 安装选项: `tauri.conf.json` 中的 `windows.nsis` 配置

## 常见问题

### 1. Rust 编译错误
```bash
# 更新 Rust 工具链
rustup update

# 清理缓存重新编译
cargo clean
npm run tauri build
```

### 2. 依赖安装失败
```bash
# 清理 npm 缓存
npm cache clean --force

# 删除 node_modules 重新安装
rm -rf node_modules
npm install
```

### 3. 截图功能异常
- 检查系统权限
- 确认 Rust 依赖安装完整
- 查看控制台错误信息

### 4. 快捷键不生效
- 检查快捷键是否被其他应用占用
- 确认系统权限（需要管理员权限）
- 查看 Rust 日志输出

## 性能优化建议

### 前端优化
1. 使用 React.memo 避免不必要的重渲染
2. 懒加载非关键组件
3. 优化图片资源（base64 压缩）

### Rust 优化
1. 使用异步操作避免阻塞主线程
2. 合理使用缓存
3. 优化内存使用

### 打包优化
1. 移除未使用的依赖
2. 压缩资源文件
3. 优化构建配置

## 安全注意事项

1. **API Key 安全**：用户 API Key 存储在本地，不会上传到服务器
2. **截图隐私**：截图仅在用户设备本地处理，可配置是否保存到本地
3. **权限管理**：需要截图权限和系统快捷键权限
4. **数据加密**：敏感配置使用系统安全存储

## 更新日志

### v1.0.0 (计划中)
- [ ] 基础截图功能
- [ ] AI 服务集成
- [ ] 悬浮球界面
- [ ] 设置面板
- [ ] 安装包制作

---

更多问题请查看 [GitHub Issues](https://github.com/your-repo/issues) 或提交新 Issue。
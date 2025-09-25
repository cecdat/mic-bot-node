# mic-bot-node

Microsoft Rewards Bot Node - 微软奖励机器人节点

> **基于 [Microsoft-Rewards-Script](https://github.com/TheNetsky/Microsoft-Rewards-Script) 二次开发**  
> 感谢 [@TheNetsky](https://github.com/TheNetsky) 提供的优秀自动化框架和灵感

## 🆚 与原项目的差异

### 原项目特性
- 单机版自动化脚本，依赖 Cron 定时执行
- 本地配置文件管理
- 简单的日志输出
- 基础的浏览器自动化

### 我们的扩展
- **分布式节点架构**: 支持多节点部署，提高可扩展性
- **集中式管理**: 通过 `mic-bot-service` 统一管理所有节点
- **实时监控**: WebSocket 连接实现实时状态监控
- **智能任务调度**: 支持交叉执行和智能任务分配
- **高级缓存管理**: 自动处理浏览器缓存问题
- **完善的日志系统**: 本地日志记录和容器日志查看
- **容器化部署**: Docker 支持，简化部署流程

## 🏗️ 系统架构

### 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                    mic-bot-service (指挥中心)                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │    Web UI   │  │   API 服务  │  │  数据库     │              │
│  │   (管理界面) │  │  (REST API) │  │ (PostgreSQL)│              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│         │                 │                 │                   │
│         └─────────────────┼─────────────────┘                   │
│                           │                                     │
│  ┌─────────────────────────┼─────────────────────────┐          │
│  │              WebSocket 服务                        │          │
│  │         (实时通信和任务调度)                         │          │
│  └─────────────────────────┼─────────────────────────┘          │
└────────────────────────────┼─────────────────────────────────────┘
                             │
                             │ HTTP API + WebSocket
                             │
┌────────────────────────────┼─────────────────────────────────────┐
│                    mic-bot-node (工作节点)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │  浏览器引擎  │  │  任务执行器  │  │  日志系统   │              │
│  │ (Playwright) │  │ (Workers)   │  │ (Logger)    │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│         │                 │                 │                   │
│         └─────────────────┼─────────────────┘                   │
│                           │                                     │
│  ┌─────────────────────────┼─────────────────────────┐          │
│  │              账户管理                              │          │
│  │        (登录、任务执行、积分统计)                    │          │
│  └─────────────────────────┼─────────────────────────┘          │
└────────────────────────────┼─────────────────────────────────────┘
                             │
                             │ 自动化操作
                             │
┌────────────────────────────┼─────────────────────────────────────┐
│                    Microsoft Rewards                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   Bing 搜索 │  │   每日任务   │  │   移动端    │              │
│  │  (桌面/移动)│  │  (签到/阅读) │  │   任务      │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

### 节点与指挥中心交互流程

```
1. 节点启动
   ┌─────────────┐
   │ mic-bot-node │
   └──────┬──────┘
          │
          │ 1. 发送签到请求
          ▼
   ┌─────────────┐
   │ mic-bot-service │
   │ (节点管理)   │
   └──────┬──────┘
          │
          │ 2. 返回节点ID和配置
          ▼
   ┌─────────────┐
   │ mic-bot-node │
   │ (进入待机)   │
   └──────┬──────┘
          │
          │ 3. 建立WebSocket连接
          ▼
   ┌─────────────┐
   │ mic-bot-service │
   │ (WebSocket服务) │
   └──────┬──────┘
          │
          │ 4. 开始长轮询监听
          ▼
   ┌─────────────┐
   │ mic-bot-node │
   │ (等待指令)   │
   └──────┬──────┘
          │
          │ 5. 用户点击"运行"按钮
          ▼
   ┌─────────────┐
   │ mic-bot-service │
   │ (发送RUN_TASKS) │
   └──────┬──────┘
          │
          │ 6. 接收任务指令
          ▼
   ┌─────────────┐
   │ mic-bot-node │
   │ (执行任务)   │
   └──────┬──────┘
          │
          │ 7. 更新执行状态
          ▼
   ┌─────────────┐
   │ mic-bot-service │
   │ (实时监控)   │
   └──────┬──────┘
          │
          │ 8. 任务完成，返回待机
          ▼
   ┌─────────────┐
   │ mic-bot-node │
   │ (继续监听)   │
   └─────────────┘
```

## 🔄 与 mic-bot-service 的交互逻辑

### 核心工作模式：守护进程与长轮询

`mic-bot-node` 是一个**常驻服务（守护进程）**，其核心工作流程如下：

1. **启动与签到**: 容器启动后，节点会立即向指挥中心进行"签到"，报告自己已上线
2. **心跳维持**: 按照配置的 `heartbeatInterval` 间隔，定期发送心跳维持"在线"状态
3. **长轮询监听**: 持续向指挥中心发送长轮询请求，等待服务器指令
4. **接收并执行任务**: 收到 `RUN_TASKS` 指令后，获取分配的账户列表并执行任务
5. **完成并返回待机**: 任务完成后报告状态，继续监听新指令

### 通信协议

#### HTTP API 通信
- **节点签到**: `POST /bot_api/checkin`
- **获取账户**: `GET /bot_api/accounts`
- **状态更新**: `POST /bot_api/status`
- **获取配置**: `GET /bot_api/config`

#### WebSocket 通信
- **实时指令**: 接收 `RUN_TASKS`、`STOP_TASKS` 等指令
- **状态同步**: 实时推送任务执行状态
- **心跳检测**: 维持连接活跃状态

## 📁 项目结构

```
mic-bot-node/
├── app/                          # 业务代码目录
│   ├── src/                      # 源代码
│   │   ├── index.ts              # 主入口文件
│   │   ├── browser/              # 浏览器相关
│   │   │   ├── Browser.ts        # 浏览器管理
│   │   │   ├── BrowserFunc.ts    # 浏览器功能
│   │   │   └── BrowserUtil.ts    # 浏览器工具
│   │   ├── interface/            # 接口定义
│   │   │   ├── Config.ts         # 配置接口
│   │   │   ├── Account.ts        # 账户接口
│   │   │   └── DashboardData.ts  # 仪表板数据接口
│   │   ├── functions/            # 核心功能
│   │   │   ├── Login.ts          # 登录功能
│   │   │   ├── Workers.ts        # 任务执行器
│   │   │   └── Activities.ts     # 活动任务
│   │   ├── handlers/             # 异常处理器
│   │   │   ├── LoginExceptionHandler.ts
│   │   │   └── PageExceptionDetector.ts
│   │   ├── util/                 # 工具类
│   │   │   ├── Load.ts           # 数据加载
│   │   │   ├── Logger.ts         # 日志工具
│   │   │   ├── FailedTaskManager.ts # 失败任务管理
│   │   │   └── CacheManager.ts   # 缓存管理
│   ├── package.json              # 应用依赖
│   ├── tsconfig.json             # TypeScript 配置
│   └── requirements.txt          # Python 依赖
├── node/                         # 节点目录
│   ├── node-1/                   # 节点1
│   │   ├── config.json           # 节点1配置
│   │   └── sessions/             # 节点1会话数据
│   ├── node-2/                   # 节点2
│   │   ├── config.json           # 节点2配置
│   │   └── sessions/             # 节点2会话数据
│   └── ...                       # 更多节点
├── deployments/                  # 部署文件
│   ├── docker/                   # Docker 构建文件
│   ├── compose/                  # Docker Compose 配置
│   └── scripts/                  # 部署和管理脚本
├── docs/                         # 文档目录
│   ├── README.md                 # 详细说明文档
│   ├── CACHE_MANAGEMENT.md       # 缓存管理说明
│   └── ...                       # 其他文档
├── docker-compose.yaml           # Docker Compose 配置
├── README.md                     # 项目说明
└── README_EN.md                  # 英文说明
```

## ✨ 功能特性

### 🚀 核心功能
- **分布式执行**: 支持多节点并行执行，提高效率
- **智能任务调度**: 自动分配任务到不同节点
- **交叉执行模式**: 支持桌面端和移动端任务交叉执行
- **实时监控**: WebSocket 实时状态监控
- **自动恢复**: 智能处理浏览器错误和网络异常

### 🛡️ 稳定性保障
- **缓存管理**: 自动清理浏览器缓存，解决 chrome-error 问题
- **错误处理**: 完善的异常处理和重试机制
- **心跳检测**: 定期心跳维持连接状态
- **会话保持**: 智能会话管理和恢复

### 📊 监控与日志
- **本地日志**: 节点本地日志记录和查看
- **容器日志**: 通过 Docker 查看容器日志
- **分级日志**: 支持不同级别的日志过滤
- **实时状态**: 任务执行状态实时更新

### 🔧 配置管理
- **动态配置**: 支持运行时配置更新
- **多环境支持**: 支持开发、测试、生产环境
- **灵活部署**: Docker 容器化部署
- **安全认证**: API Token 认证机制

## 🚀 快速开始

### 前置条件
- 已部署并运行的 `mic-bot-service` 指挥中心
- Docker 和 Docker Compose 环境
- 可访问外网的网络环境

### 1. 获取 API Token
1. 登录 `mic-bot-service` 管理界面
2. 进入"节点管理"页面
3. 点击"新增节点"，输入节点名称
4. 复制生成的 API Token

### 2. 配置节点
编辑 `node/node-1/config.json`：
```json
{
  "apiServer": {
    "enabled": true,
    "updateUrl": "http://your-service:2002/",
    "token": "your-api-token",
    "nodeName": "your-node-name",
    "heartbeatInterval": "45s"
  }
}
```

### 3. 启动节点
```bash
# 构建并启动
docker-compose up -d --build

# 查看日志
docker logs -f mic-bot-node
```

### 4. 验证部署
- 在 `mic-bot-service` 节点管理页面查看节点状态
- 确认节点显示为"在线"和"待机"状态
- 点击"运行"按钮测试任务执行

## ⚙️ 配置说明

### 主要配置项
```json
{
  "apiServer": {
    "enabled": true,                    // 启用API服务器连接
    "updateUrl": "http://your-server:2002/",  // 指挥中心地址
    "token": "your-api-token",          // API认证令牌
    "nodeName": "your-node-name",       // 节点名称
    "heartbeatInterval": "45s",         // 心跳间隔
    "heartbeatTimeout": "10m"           // 心跳超时
  },
  "cacheManagement": {                  // 缓存管理配置
    "clearCacheOnStart": true,          // 启动时清理缓存
    "autoClearOnChromeError": true,     // 自动清理chrome-error
    "clearLocalStorage": true,          // 清理localStorage
    "clearSessionStorage": true,        // 清理sessionStorage
    "clearIndexedDB": true,             // 清理IndexedDB
    "clearCacheAPI": true,              // 清理Cache API
    "clearCookies": true,               // 清理Cookies
    "clearPermissions": true            // 清理权限
  },
  "search_cross_execution": true,       // 启用交叉执行模式
  "clusters": 2,                        // 并发账户数
  "headless": true,                     // 无头模式
  "debug": false                        // 调试模式
}
```

### 高级配置
- **并发控制**: 通过 `clusters` 参数控制并发数量
- **搜索延迟**: 支持配置搜索间隔的随机延迟
- **调试选项**: 支持任务执行前后的快照和调试信息保存
- **缓存管理**: 智能缓存清理，解决浏览器错误问题

## 🛠️ 技术架构

### 核心技术栈
- **TypeScript**: 提供类型安全和更好的开发体验
- **Playwright**: 现代化的浏览器自动化框架
- **Node.js**: 运行时环境
- **Docker**: 容器化部署
- **Axios**: HTTP客户端，用于与指挥中心通信
- **Socket.IO**: WebSocket通信库

### 主要模块
- **Browser**: 浏览器管理和上下文创建
- **Login**: 登录逻辑处理
- **Workers**: 任务执行引擎
- **Activities**: 各种活动任务实现
- **Logger**: 日志记录模块
- **CacheManager**: 缓存管理模块
- **FailedTaskManager**: 失败任务管理器
- **ExceptionHandler**: 异常处理器

## 🔧 故障排除

### 常见问题

#### 1. 节点无法连接指挥中心
**症状**: 节点状态显示为"离线"
**解决方案**:
- 检查 `updateUrl` 配置是否正确
- 确认网络连接是否正常
- 验证 API Token 是否有效
- 检查防火墙设置

#### 2. chrome-error 页面错误
**症状**: 出现 `chrome-error://chromewebdata/` 错误
**解决方案**:
- 启用缓存管理配置
- 检查浏览器启动参数
- 查看缓存清理日志

#### 3. 任务执行失败
**症状**: 任务执行过程中出现错误
**解决方案**:
- 检查账户配置是否正确
- 查看详细错误日志
- 验证网络连接状态
- 检查浏览器环境

#### 4. WebSocket 连接问题
**症状**: 无法接收实时指令
**解决方案**:
- 检查 WebSocket 服务是否正常
- 验证网络代理设置
- 查看连接超时配置

### 日志查看
```bash
# 查看容器日志
docker logs -f mic-bot-node

# 查看最近的日志
docker logs --tail=100 mic-bot-node

# 查看节点状态
# 在 mic-bot-service 节点管理页面查看节点状态
```

## 📚 相关文档

- [详细配置说明](docs/README.md) - 完整的配置和部署指南
- [缓存管理配置](docs/CACHE_MANAGEMENT.md) - 浏览器缓存管理说明
- [版本管理指南](docs/VERSION_MANAGEMENT.md) - 版本升级和迁移指南
- [任务命令延迟修复](docs/TASK_COMMAND_DELAY_FIX.md) - 任务执行优化说明

## ⚠️ 免责声明

使用此脚本可能会导致您的微软账户被封禁或暂停，请您自行承担风险！

## 📄 许可证

本项目采用 [MIT](https://opensource.org/licenses/MIT) 许可证。

## 🙏 致谢

本项目基于 [@TheNetsky](https://github.com/TheNetsky) 的优秀作品 [Microsoft-Rewards-Script](https://github.com/TheNetsky/Microsoft-Rewards-Script) 进行二次开发。我们对原始自动化框架和灵感表示诚挚的感谢。

**原项目特性:**
- 使用 TypeScript、Cheerio 和 Playwright 构建的自动化 Microsoft Rewards 脚本
- 支持多账户和会话管理
- 全面的任务自动化，包括搜索、测验和活动
- Docker 支持和调度功能
- Discord Webhook 集成通知

**我们的项目扩展:**
- 分布式节点架构，提高可扩展性
- 集中管理系统
- 实时监控和控制
- 增强的交叉执行能力
- 高级会话管理
- 智能缓存管理
- 完善的日志系统
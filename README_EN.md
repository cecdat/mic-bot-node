# mic-bot-node

Microsoft Rewards Bot Node - Distributed Microsoft Rewards Automation System

> **Based on [Microsoft-Rewards-Script](https://github.com/TheNetsky/Microsoft-Rewards-Script) for secondary development**  
> Thanks to [@TheNetsky](https://github.com/TheNetsky) for the excellent automation framework and inspiration

## 🆚 Differences from Original Project

### Original Project Features
- Standalone automation script with Cron-based scheduling
- Local configuration file management
- Simple log output
- Basic browser automation

### Our Extensions
- **Distributed Node Architecture**: Support for multi-node deployment, improving scalability
- **Centralized Management**: Unified management of all nodes through `mic-bot-service`
- **Real-time Monitoring**: WebSocket connections for real-time status monitoring
- **Intelligent Task Scheduling**: Support for cross-execution and smart task allocation
- **Advanced Cache Management**: Automatic handling of browser cache issues
- **Comprehensive Logging System**: Local log recording and container log viewing
- **Containerized Deployment**: Docker support for simplified deployment

## 🏗️ System Architecture

### Overall Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    mic-bot-service (Command Center)             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │    Web UI   │  │   API Service│  │  Database   │              │
│  │ (Management)│  │  (REST API) │  │(PostgreSQL) │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│         │                 │                 │                   │
│         └─────────────────┼─────────────────┘                   │
│                           │                                     │
│  ┌─────────────────────────┼─────────────────────────┐          │
│  │              WebSocket Service                     │          │
│  │         (Real-time Communication & Task Scheduling)│          │
│  └─────────────────────────┼─────────────────────────┘          │
└────────────────────────────┼─────────────────────────────────────┘
                             │
                             │ HTTP API + WebSocket
                             │
┌────────────────────────────┼─────────────────────────────────────┐
│                    mic-bot-node (Worker Node)                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ Browser Engine│  │Task Executor│  │ Log System │              │
│  │ (Playwright) │  │ (Workers)   │  │ (Logger)   │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│         │                 │                 │                   │
│         └─────────────────┼─────────────────┘                   │
│                           │                                     │
│  ┌─────────────────────────┼─────────────────────────┐          │
│  │              Account Management                    │          │
│  │        (Login, Task Execution, Points Tracking)   │          │
│  └─────────────────────────┼─────────────────────────┘          │
└────────────────────────────┼─────────────────────────────────────┘
                             │
                             │ Automated Operations
                             │
┌────────────────────────────┼─────────────────────────────────────┐
│                    Microsoft Rewards                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │  Bing Search│  │ Daily Tasks │  │ Mobile Tasks│              │
│  │(Desktop/Mobile)│  │(Check-in/Read)│ │            │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

### Node-Command Center Interaction Flow

```
1. Node Startup
   ┌─────────────┐
   │ mic-bot-node │
   └──────┬──────┘
          │
          │ 1. Send check-in request
          ▼
   ┌─────────────┐
   │ mic-bot-service │
   │ (Node Management)│
   └──────┬──────┘
          │
          │ 2. Return node ID and config
          ▼
   ┌─────────────┐
   │ mic-bot-node │
   │ (Enter Standby)│
   └──────┬──────┘
          │
          │ 3. Establish WebSocket connection
          ▼
   ┌─────────────┐
   │ mic-bot-service │
   │ (WebSocket Service)│
   └──────┬──────┘
          │
          │ 4. Start long polling
          ▼
   ┌─────────────┐
   │ mic-bot-node │
   │ (Wait for Commands)│
   └──────┬──────┘
          │
          │ 5. User clicks "Run" button
          ▼
   ┌─────────────┐
   │ mic-bot-service │
   │ (Send RUN_TASKS)│
   └──────┬──────┘
          │
          │ 6. Receive task command
          ▼
   ┌─────────────┐
   │ mic-bot-node │
   │ (Execute Tasks)│
   └──────┬──────┘
          │
          │ 7. Update execution status
          ▼
   ┌─────────────┐
   │ mic-bot-service │
   │ (Real-time Monitor)│
   └──────┬──────┘
          │
          │ 8. Task completed, return to standby
          ▼
   ┌─────────────┐
   │ mic-bot-node │
   │ (Continue Listening)│
   └─────────────┘
```

## 🔄 Interaction Logic with mic-bot-service

### Core Working Mode: Daemon Process with Long Polling

`mic-bot-node` is a **resident service (daemon process)** with the following core workflow:

1. **Startup & Check-in**: After container startup, the node immediately "checks in" with the command center to report its online status
2. **Heartbeat Maintenance**: Regularly sends heartbeats at configured `heartbeatInterval` to maintain "online" status
3. **Long Polling**: Continuously sends long polling requests to the command center, waiting for server commands
4. **Receive & Execute Tasks**: After receiving `RUN_TASKS` command, fetches assigned account list and executes tasks
5. **Complete & Return to Standby**: After task completion, reports status and continues listening for new commands

### Communication Protocol

#### HTTP API Communication
- **Node Check-in**: `POST /bot_api/checkin`
- **Get Accounts**: `GET /bot_api/accounts`
- **Status Update**: `POST /bot_api/status`
- **Get Config**: `GET /bot_api/config`

#### WebSocket Communication
- **Real-time Commands**: Receive `RUN_TASKS`, `STOP_TASKS` commands
- **Status Sync**: Real-time task execution status push
- **Heartbeat Detection**: Maintain connection active status

## 📁 Project Structure

```
mic-bot-node/
├── app/                          # Business code directory
│   ├── src/                      # Source code
│   │   ├── index.ts              # Main entry file
│   │   ├── browser/              # Browser related
│   │   │   ├── Browser.ts        # Browser management
│   │   │   ├── BrowserFunc.ts    # Browser functions
│   │   │   └── BrowserUtil.ts    # Browser utilities
│   │   ├── interface/            # Interface definitions
│   │   │   ├── Config.ts         # Configuration interface
│   │   │   ├── Account.ts        # Account interface
│   │   │   └── DashboardData.ts  # Dashboard data interface
│   │   ├── functions/            # Core functions
│   │   │   ├── Login.ts          # Login functionality
│   │   │   ├── Workers.ts        # Task executor
│   │   │   └── Activities.ts     # Activity tasks
│   │   ├── handlers/             # Exception handlers
│   │   │   ├── LoginExceptionHandler.ts
│   │   │   └── PageExceptionDetector.ts
│   │   ├── util/                 # Utility classes
│   │   │   ├── Load.ts           # Data loading
│   │   │   ├── Logger.ts         # Logging utilities
│   │   │   ├── FailedTaskManager.ts # Failed task manager
│   │   │   └── CacheManager.ts   # Cache management
│   ├── package.json              # Application dependencies
│   ├── tsconfig.json             # TypeScript configuration
│   └── requirements.txt          # Python dependencies
├── node/                         # Node directory
│   ├── node-1/                   # Node 1
│   │   ├── config.json           # Node 1 configuration
│   │   └── sessions/             # Node 1 session data
│   ├── node-2/                   # Node 2
│   │   ├── config.json           # Node 2 configuration
│   │   └── sessions/             # Node 2 session data
│   └── ...                       # More nodes
├── deployments/                  # Deployment files
│   ├── docker/                   # Docker build files
│   ├── compose/                  # Docker Compose configuration
│   └── scripts/                  # Deployment and management scripts
├── docs/                         # Documentation directory
│   ├── README.md                 # Detailed documentation
│   ├── CACHE_MANAGEMENT.md       # Cache management guide
│   └── ...                       # Other documentation
├── docker-compose.yaml           # Docker Compose configuration
├── README.md                     # Project description
└── README_EN.md                  # English description
```

## ✨ Features

### 🚀 Core Features
- **Distributed Execution**: Support for multi-node parallel execution, improving efficiency
- **Intelligent Task Scheduling**: Automatic task allocation to different nodes
- **Cross-execution Mode**: Support for desktop and mobile task cross-execution
- **Real-time Monitoring**: WebSocket real-time status monitoring
- **Auto Recovery**: Intelligent handling of browser errors and network exceptions

### 🛡️ Stability Assurance
- **Cache Management**: Automatic browser cache cleanup, solving chrome-error issues
- **Error Handling**: Comprehensive exception handling and retry mechanisms
- **Heartbeat Detection**: Regular heartbeat maintenance of connection status
- **Session Persistence**: Intelligent session management and recovery

### 📊 Monitoring & Logging
- **Local Logging**: Node local log recording and viewing
- **Container Logs**: View container logs through Docker
- **Log Levels**: Support for different log level filtering
- **Real-time Status**: Real-time task execution status updates

### 🔧 Configuration Management
- **Dynamic Configuration**: Support for runtime configuration updates
- **Multi-environment Support**: Support for development, testing, production environments
- **Flexible Deployment**: Docker containerized deployment
- **Security Authentication**: API Token authentication mechanism

## 🚀 Quick Start

### Prerequisites
- Deployed and running `mic-bot-service` command center
- Docker and Docker Compose environment
- Network environment with external access

### 1. Get API Token
1. Login to `mic-bot-service` management interface
2. Navigate to "Node Management" page
3. Click "Add Node", enter node name
4. Copy the generated API Token

### 2. Configure Node
Edit `node/node-1/config.json`:
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

### 3. Start Node
```bash
# Build and start
docker-compose up -d --build

# View logs
docker logs -f mic-bot-node
```

### 4. Verify Deployment
- Check node status in `mic-bot-service` node management page
- Confirm node shows as "Online" and "Standby" status
- Click "Run" button to test task execution

## ⚙️ Configuration

### Main Configuration Items
```json
{
  "apiServer": {
    "enabled": true,                    // Enable API server connection
    "updateUrl": "http://your-server:2002/",  // Command center address
    "token": "your-api-token",          // API authentication token
    "nodeName": "your-node-name",       // Node name
    "heartbeatInterval": "45s",         // Heartbeat interval
    "heartbeatTimeout": "10m"           // Heartbeat timeout
  },
  "cacheManagement": {                  // Cache management configuration
    "clearCacheOnStart": true,          // Clear cache on startup
    "autoClearOnChromeError": true,     // Auto clear chrome-error
    "clearLocalStorage": true,          // Clear localStorage
    "clearSessionStorage": true,        // Clear sessionStorage
    "clearIndexedDB": true,             // Clear IndexedDB
    "clearCacheAPI": true,              // Clear Cache API
    "clearCookies": true,               // Clear Cookies
    "clearPermissions": true            // Clear permissions
  },
  "search_cross_execution": true,       // Enable cross-execution mode
  "clusters": 2,                        // Concurrent account count
  "headless": true,                     // Headless mode
  "debug": false                        // Debug mode
}
```

### Advanced Configuration
- **Concurrency Control**: Control concurrency through `clusters` parameter
- **Search Delay**: Support for configuring random delays in search intervals
- **Debug Options**: Support for saving snapshots and debug information before/after task execution
- **Cache Management**: Intelligent cache cleanup, solving browser error issues

## 🛠️ Technical Architecture

### Core Technology Stack
- **TypeScript**: Provides type safety and better development experience
- **Playwright**: Modern browser automation framework
- **Node.js**: Runtime environment
- **Docker**: Containerized deployment
- **Axios**: HTTP client for communication with command center
- **Socket.IO**: WebSocket communication library

### Main Modules
- **Browser**: Browser management and context creation
- **Login**: Login logic handling
- **Workers**: Task execution engine
- **Activities**: Various activity task implementations
- **Logger**: Log recording module
- **CacheManager**: Cache management module
- **FailedTaskManager**: Failed task manager
- **ExceptionHandler**: Exception handler

## 🔧 Troubleshooting

### Common Issues

#### 1. Node Cannot Connect to Command Center
**Symptoms**: Node status shows as "Offline"
**Solutions**:
- Check if `updateUrl` configuration is correct
- Confirm network connection is normal
- Verify API Token is valid
- Check firewall settings

#### 2. chrome-error Page Error
**Symptoms**: `chrome-error://chromewebdata/` error appears
**Solutions**:
- Enable cache management configuration
- Check browser startup parameters
- View cache cleanup logs

#### 3. Task Execution Failure
**Symptoms**: Errors occur during task execution
**Solutions**:
- Check if account configuration is correct
- View detailed error logs
- Verify network connection status
- Check browser environment

#### 4. WebSocket Connection Issues
**Symptoms**: Cannot receive real-time commands
**Solutions**:
- Check if WebSocket service is normal
- Verify network proxy settings
- Check connection timeout configuration

### Log Viewing
```bash
# View container logs
docker logs -f mic-bot-node

# View recent logs
docker logs --tail=100 mic-bot-node

# View node status
# Check node status in mic-bot-service node management page
```

## 📚 Related Documentation

- [Detailed Configuration Guide](docs/README.md) - Complete configuration and deployment guide
- [Cache Management Configuration](docs/CACHE_MANAGEMENT.md) - Browser cache management guide
- [Version Management Guide](docs/VERSION_MANAGEMENT.md) - Version upgrade and migration guide
- [Task Command Delay Fix](docs/TASK_COMMAND_DELAY_FIX.md) - Task execution optimization guide

## ⚠️ Disclaimer

Using this script may result in your Microsoft account being banned or suspended. Please use at your own risk!

## 📄 License

This project is licensed under the [MIT](https://opensource.org/licenses/MIT) License.

## 🙏 Acknowledgments

This project is based on the excellent work [Microsoft-Rewards-Script](https://github.com/TheNetsky/Microsoft-Rewards-Script) by [@TheNetsky](https://github.com/TheNetsky) for secondary development. We express our sincere gratitude for the original automation framework and inspiration.

**Original Project Features:**
- Microsoft Rewards automation script built with TypeScript, Cheerio, and Playwright
- Multi-account and session management support
- Comprehensive task automation including searches, quizzes, and activities
- Docker support and scheduling functionality
- Discord Webhook integration for notifications

**Our Project Extensions:**
- Distributed node architecture for improved scalability
- Centralized management system
- Real-time monitoring and control
- Enhanced cross-execution capabilities
- Advanced session management
- Intelligent cache management
- Comprehensive logging system
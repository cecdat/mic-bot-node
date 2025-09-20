# 升级场景处理说明

## 问题描述

在升级场景下，如果 `node-*` 目录已经存在，部署脚本应该：
- ✅ 跳过创建，避免覆盖现有配置和数据
- ✅ 检查并补充缺失的文件
- ✅ 保持现有配置不变

## 修复内容

### 1. Linux 脚本 (start.sh) 优化

**修复前**：
```bash
if [ -d "$node_dir" ]; then
    print_color $YELLOW "节点目录 $node_dir 已存在，跳过创建"
    return
fi
```

**修复后**：
```bash
if [ -d "$node_dir" ]; then
    print_color $GREEN "✅ 节点目录 $node_dir 已存在"
    
    # 检查配置文件是否存在
    if [ -f "$config_file" ]; then
        print_color $GREEN "✅ 配置文件 $config_file 已存在"
    else
        print_color $YELLOW "⚠️ 配置文件不存在，创建默认配置..."
        create_default_config "$config_file" "$node_name"
    fi
    
    # 检查会话目录是否存在
    if [ -d "$sessions_dir" ]; then
        print_color $GREEN "✅ 会话目录 $sessions_dir 已存在"
    else
        print_color $YELLOW "⚠️ 会话目录不存在，创建目录..."
        mkdir -p "$sessions_dir"
    fi
    
    print_color $BLUE "📋 节点 $node_name 配置检查完成，跳过创建"
    return
fi
```

### 2. Windows 脚本 (start.bat) 优化

**修复前**：
```batch
if exist "!node_dir!" (
    echo 节点目录 !node_dir! 已存在，跳过创建
    goto :eof
)
```

**修复后**：
```batch
if exist "!node_dir!" (
    echo ✅ 节点目录 !node_dir! 已存在
    
    if exist "!config_file!" (
        echo ✅ 配置文件 !config_file! 已存在
    ) else (
        echo ⚠️ 配置文件不存在，创建默认配置...
        call :create_default_config "!config_file!" "!node_name!"
    )
    
    if exist "!sessions_dir!" (
        echo ✅ 会话目录 !sessions_dir! 已存在
    ) else (
        echo ⚠️ 会话目录不存在，创建目录...
        mkdir "!sessions_dir!" 2>nul
    )
    
    echo 📋 节点 !node_name! 配置检查完成，跳过创建
    goto :eof
)
```

### 3. 新增 create_default_config 函数

为了避免重复代码，新增了 `create_default_config` 函数：

**Linux 版本**：
```bash
create_default_config() {
    local config_file=$1
    local node_name=$2
    
    cat > "$config_file" << EOF
{
  "apiServer": {
    "enabled": true,
    "updateUrl": "$DEFAULT_SERVER_URL",
    "token": "YOUR_TOKEN_HERE",
    "nodeName": "$node_name",
    "heartbeatInterval": "5m",
    "heartbeatTimeout": "30s"
  },
  // ... 其他配置
}
EOF
}
```

**Windows 版本**：
```batch
:create_default_config
set config_file=%~1
set node_name=%~2

echo {> "!config_file!"
echo   "apiServer": {>> "!config_file!"
echo     "enabled": true,>> "!config_file!"
echo     "updateUrl": "!DEFAULT_SERVER_URL!",>> "!config_file!"
echo     "token": "YOUR_TOKEN_HERE",>> "!config_file!"
echo     "nodeName": "!node_name!",>> "!config_file!"
// ... 其他配置
echo }>> "!config_file!"
goto :eof
```

## 升级场景测试

### 1. 首次部署

```bash
# 首次部署，创建新节点
./start.sh deploy 2

# 预期输出
🚀 开始部署 2 个节点...
>>> 检查节点 1: node-1
🆕 创建新节点 node-1...
✅ 节点 1 配置创建完成
>>> 检查节点 2: node-2
🆕 创建新节点 node-2...
✅ 节点 2 配置创建完成
```

### 2. 升级部署（节点已存在）

```bash
# 再次部署，节点已存在
./start.sh deploy 2

# 预期输出
🚀 开始部署 2 个节点...
>>> 检查节点 1: node-1
✅ 节点目录 ../../node/node-1 已存在
✅ 配置文件 ../../node/node-1/config.json 已存在
✅ 会话目录 ../../node/node-1/sessions 已存在
📋 节点 node-1 配置检查完成，跳过创建
>>> 检查节点 2: node-2
✅ 节点目录 ../../node/node-2 已存在
✅ 配置文件 ../../node/node-2/config.json 已存在
✅ 会话目录 ../../node/node-2/sessions 已存在
📋 节点 node-2 配置检查完成，跳过创建
```

### 3. 部分缺失文件场景

```bash
# 模拟配置文件被删除的情况
rm node/node-1/config.json

# 重新部署
./start.sh deploy 1

# 预期输出
🚀 开始部署 1 个节点...
>>> 检查节点 1: node-1
✅ 节点目录 ../../node/node-1 已存在
⚠️ 配置文件不存在，创建默认配置...
✅ 配置文件 ../../node/node-1/config.json 已存在
✅ 会话目录 ../../node/node-1/sessions 已存在
📋 节点 node-1 配置检查完成，跳过创建
```

### 4. 扩展节点数量

```bash
# 从 2 个节点扩展到 4 个节点
./start.sh deploy 4

# 预期输出
🚀 开始部署 4 个节点...
>>> 检查节点 1: node-1
✅ 节点目录 ../../node/node-1 已存在
✅ 配置文件 ../../node/node-1/config.json 已存在
✅ 会话目录 ../../node/node-1/sessions 已存在
📋 节点 node-1 配置检查完成，跳过创建
>>> 检查节点 2: node-2
✅ 节点目录 ../../node/node-2 已存在
✅ 配置文件 ../../node/node-2/config.json 已存在
✅ 会话目录 ../../node/node-2/sessions 已存在
📋 节点 node-2 配置检查完成，跳过创建
>>> 检查节点 3: node-3
🆕 创建新节点 node-3...
✅ 节点 3 配置创建完成
>>> 检查节点 4: node-4
🆕 创建新节点 node-4...
✅ 节点 4 配置创建完成
```

## 优势

### 1. 数据保护
- ✅ 不会覆盖现有的配置文件
- ✅ 不会删除会话数据
- ✅ 保持用户自定义配置

### 2. 智能补充
- ✅ 自动检测缺失的文件
- ✅ 补充必要的目录结构
- ✅ 创建默认配置文件

### 3. 升级友好
- ✅ 支持增量部署
- ✅ 支持节点数量扩展
- ✅ 支持部分文件恢复

### 4. 详细日志
- ✅ 清晰的状态显示
- ✅ 区分新创建和已存在
- ✅ 显示具体操作内容

## 注意事项

1. **配置文件保护**：现有配置文件不会被覆盖，即使内容可能过时
2. **手动更新**：用户需要手动更新配置文件中的新字段
3. **数据备份**：建议在升级前备份重要数据
4. **版本兼容**：确保新版本与现有配置兼容

## 最佳实践

### 1. 升级前准备
```bash
# 备份现有配置
cp -r node node.backup.$(date +%Y%m%d)

# 检查现有配置
ls -la node/
```

### 2. 升级过程
```bash
# 执行升级部署
./start.sh deploy

# 检查升级结果
./start.sh logs
```

### 3. 升级后验证
```bash
# 验证配置文件
cat node/node-1/config.json

# 验证服务状态
docker-compose -f deployments/compose/docker-compose.yaml ps
```

现在升级场景下的节点创建逻辑已经优化完成，能够智能地处理已存在的节点目录，避免覆盖现有配置和数据！🎉

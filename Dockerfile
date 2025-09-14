# Stage 1: Builder (compile TypeScript)
FROM docker.1ms.run/node:20-slim AS builder
ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# 设置npm使用国内镜像源
RUN npm config set registry https://registry.npmmirror.com && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000

COPY package*.json ./
# Use npm ci for faster, more reliable builds if package-lock.json exists
RUN npm install

COPY . .

# 添加调试信息并修复构建
RUN echo "开始TypeScript编译..." && \
    # 跳过pre-build脚本中的playwright安装，直接编译TypeScript
    npx tsc && \
    echo "TypeScript编译完成" && \
    ls -la dist/

# Stage 2: Production Runtime
FROM mcr.microsoft.com/playwright:v1.52.0-jammy
ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# 设置apt使用国内镜像源
RUN if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
        sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources && \
        sed -i 's/security.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources; \
    elif [ -f /etc/apt/sources.list ]; then \
        sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list && \
        sed -i 's/security.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list; \
    fi

# Install Python and pip, which are needed for the hot search script
RUN DEBIAN_FRONTEND=noninteractive apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
    && echo 'Asia/Shanghai' > /etc/timezone

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Copy only necessary production dependencies from the builder stage
COPY --from=builder /app/package*.json ./
# 设置npm使用国内镜像源并安装生产依赖
RUN npm config set registry https://registry.npmmirror.com && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm install --omit=dev

# Copy compiled app and python script from the builder stage
COPY --from=builder /app/dist ./dist
COPY get_all_hots.py .
COPY requirements.txt .

# Create search_terms directory
RUN mkdir -p /app/dist/search_terms

# Install Python dependencies
RUN pip3 install --no-cache-dir -r requirements.txt -i https://mirrors.cloud.tencent.com/pypi/simple/

# The command that will be run when the container starts
CMD ["node", "dist/index.js"]
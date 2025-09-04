# Stage 1: Builder (compile TypeScript)
FROM registry.cn-hangzhou.aliyuncs.com/library/node:18-slim AS builder
ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /app

COPY package*.json ./
# Use npm ci for faster, more reliable builds if package-lock.json exists
RUN npm install --registry=https://registry.npmmirror.com

COPY . .
RUN npm run build

# Stage 2: Production Runtime
FROM registry.cn-hangzhou.aliyuncs.com/mcr.microsoft.com/playwright:v1.52.0-jammy
#FROM swr.cn-north-4.myhuaweicloud.com/ddn-k8s/mcr.microsoft.com/playwright:v1.52.0-jammy
ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# Install Python and pip, which are needed for the hot search script
RUN DEBIAN_FRONTEND=noninteractive apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
    && echo 'Asia/Shanghai' > /etc/timezone

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Copy only necessary production dependencies from the builder stage
COPY --from=builder /app/package*.json ./
RUN npm install --omit=dev --registry=https://registry.npmmirror.com

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
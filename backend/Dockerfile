# Use Node 20 Alpine + Python
FROM node:20-alpine

WORKDIR /app

# 安装 Python（用于 generate_xls.py）
RUN apk add --no-cache python3 py3-pip && \
    pip3 install xlwt --break-system-packages

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy application code
COPY . .

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Run the app
CMD ["node", "server.js"]
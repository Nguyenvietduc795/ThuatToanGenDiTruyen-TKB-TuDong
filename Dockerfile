# ================================================================
# Dockerfile — TKB Hệ Thống
# Tương thích: Hugging Face Spaces (port 7860) + local dev (port 3000)
# ================================================================
FROM node:18-slim

# Cài Python 3 + pip
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    git \
    && rm -rf /var/lib/apt/lists/*

# Tạo symlink python → python3 (để spawnSync('python') hoạt động)
RUN ln -sf /usr/bin/python3 /usr/bin/python

WORKDIR /app

# Cài Node dependencies trước (tận dụng Docker layer cache)
COPY package*.json ./
RUN npm install --production

# Copy source code
COPY *.py ./
COPY scripts/ ./scripts/
COPY *.html *.css *.js ./
COPY solution_files/ ./solution_files/

# Biến môi trường mặc định
ENV NODE_ENV=production
ENV PYTHONUNBUFFERED=1
ENV PYTHONIOENCODING=utf-8
# PORT=7860 cho Hugging Face Spaces
# Ghi đè bằng -e PORT=3000 khi chạy local
ENV PORT=7860

EXPOSE 7860

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:' + (process.env.PORT||7860) + '/api/giangvien', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

CMD ["node", "server.js"]

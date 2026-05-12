# Dockerfile Đa nền tảng: Kết hợp Node.js + Python
FROM node:18-slim

# Cài đặt Python 3.11 và các công cụ biên dịch cần thiết
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    git \
    && rm -rf /var/lib/apt/lists/*

# Thiết lập thư mục làm việc chính trong container
WORKDIR /app

# Sao chép các file cấu hình package của Node.js (package.json, package-lock.json)
COPY package*.json ./

# Cài đặt các thư viện phụ thuộc của Node.js (chỉ cài các gói cần cho môi trường production)
RUN npm install --production

# Sao chép các file mã nguồn Python và các file mã nguồn khác
COPY *.py ./
COPY helpers.py costs.py genetic_algorithm.py ga_cli.py model.py utils.py ./
COPY scripts/ ./scripts/
COPY *.html *.css *.js ./

# Sao chép các thư mục chứa tài nguyên tĩnh
COPY solution_files/ ./solution_files/

# Cấu hình các biến môi trường
ENV NODE_ENV=production
ENV PYTHONUNBUFFERED=1
ENV PYTHONIOENCODING=utf-8

# Mở cổng mạng (Port) để truy cập ứng dụng
EXPOSE 3000

# Kiểm tra "sức khỏe" của ứng dụng (Tự động gọi API để xem server có đang chạy ổn định không)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/giangvien', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Lệnh khởi chạy ứng dụng khi Container bắt đầu hoạt động
CMD ["node", "server.js"]
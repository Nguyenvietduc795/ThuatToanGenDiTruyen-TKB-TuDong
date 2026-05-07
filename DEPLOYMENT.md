# 🚀 Hướng dẫn Deploy & Sử dụng

## Cài đặt nhanh

### 1. Clone repo
```bash
git clone https://github.com/Nguyenvietduc795/ThuatToanGenDiTruyen-TKB-TuDong.git
cd ThuatToanGenDiTruyen-TKB-TuDong
```

### 2. Setup environment
```bash
# Copy template config
cp .env.example .env.local

# Điền Supabase credentials vào .env.local
# NEXT_PUBLIC_SUPABASE_URL=your_url
# SUPABASE_SERVICE_ROLE_KEY=your_key
```

---

## 🐳 Chạy với Docker (Khuyến nghị)

### Yêu cầu
- Docker & Docker Compose cài đặt

### Chạy lần đầu
```bash
npm run docker:build
npm run docker:up
```

Ứng dụng chạy tại: **http://localhost:3000**

### Các lệnh hữu ích
```bash
# Xem logs realtime
npm run docker:logs

# Dừng container
npm run docker:down

# Rebuild & restart
npm run docker:rebuild
```

---

## 💻 Chạy local (không Docker)

### Yêu cầu
- Node.js 18+
- Python 3.11+
- Supabase account

### Cài đặt
```bash
# Install Node dependencies
npm install

# Setup Python virtual env (nếu cần)
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install Node packages
npm install

# Start server
npm start
```

Server chạy tại: **http://localhost:3000**

---

## 🌱 Seed dữ liệu

### Seed từng phần
```bash
# Seed khung thời gian
npm run seed:khung

# Seed phân công giảng dạy
npm run seed:assignments
```

### Seed tất cả
```bash
npm run seed:all
```

### Dry-run (xem trước không commit)
```bash
npm run seed:khung:dry
npm run seed:assignments:dry
```

---

## 🔄 CI/CD Pipeline

Khi push code lên GitHub, tự động:
- ✅ Build Docker image
- ✅ Check Node.js syntax
- ✅ Verify seed scripts
- ✅ Health check container

Xem workflows: `.github/workflows/`

---

## 📁 Cấu trúc thư mục

```
├── server.js              # Node.js backend
├── ga_cli.py             # Genetic Algorithm CLI
├── genetic_algorithm.py  # GA implementation
├── utils.py              # Python utilities
├── Dockerfile            # Container config
├── docker-compose.yml    # Docker compose
├── .env.example          # Environment template
├── .github/workflows/    # CI/CD
├── scripts/              # Bootstrap scripts
└── *.html               # Frontend
```

---

## 🆘 Troubleshooting

### Container không start
```bash
# Check logs
npm run docker:logs

# Rebuild từ đầu
npm run docker:rebuild
```

### Supabase connection error
- Kiểm tra `.env.local` có đúng credentials không
- Verify Network access từ IP của bạn

### Port 3000 đã được dùng
```bash
# Thay đổi port trong docker-compose.yml hoặc .env.local
PORT=3001 npm start
```

---

## 📞 Support

Mở issue trên GitHub hoặc liên hệ Nguyenvietduc795

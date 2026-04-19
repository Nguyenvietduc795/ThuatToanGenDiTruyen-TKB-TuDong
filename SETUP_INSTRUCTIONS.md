# Hướng Dẫn Khắc Phục Lỗi "Failed to fetch"

## 🔍 Nguyên Nhân Lỗi

Lỗi `TypeError: Failed to fetch` xảy ra khi:
- **Server Node.js không chạy** (cách thường gặp nhất)
- Cổng 3000 không khả dụng
- Supabase credentials không được cấu hình

---

## ✅ Giải Pháp 1: Sử Dụng Dữ Liệu Mẫu (Không Cần Server)

**Các file HTML đã được cập nhật với chức năng fallback:**
- `monhoc.html` - Môn học
- `lop.html` - Lớp học  
- `phonghoc.html` - Phòng học

**Cách hoạt động:**
1. Trang web sẽ cố gắng kết nối đến server tại `http://localhost:3000/api/...`
2. Nếu server không phản hồi, nó sẽ **tự động tải dữ liệu mẫu**
3. Bạn có thể **sử dụng, thêm, sửa, xóa** dữ liệu mẫu bình thường

**Ưu điểm:**
- ✅ Không cần cài đặt server
- ✅ Hoạt động offline
- ✅ Nhanh chóng để thử nghiệm

**Nhược điểm:**
- ❌ Dữ liệu không lưu vào cơ sở dữ liệu
- ❌ Mỗi lần reload trang sẽ mất dữ liệu

---

## 🚀 Giải Pháp 2: Khởi Động Server (Có Backend)

### Bước 1: Cài đặt dependencies

```bash
npm install
```

### Bước 2: Tạo file `.env.local`

Tạo file mới `.env.local` trong thư mục gốc với nội dung:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
PORT=3000
```

**Lấy credentials từ Supabase:**
1. Đăng nhập vào [supabase.com](https://supabase.com)
2. Vào Project Settings → API
3. Copy `Project URL` và `Anon key` / `Service Role key`

### Bước 3: Khởi động server

```bash
node server.js
```

**Output mong đợi:**
```
[Backend] Server đang chạy tại: http://localhost:3000
[API] Giảng viên: http://localhost:3000/api/giangvien
[API] Lớp: http://localhost:3000/api/lop
[API] Môn học: http://localhost:3000/api/monhoc
[API] Phòng học: http://localhost:3000/api/phonghoc
```

### Bước 4: Mở trang web

Mở file HTML trong trình duyệt (hoặc sử dụng Live Server):
- `http://localhost:5500/monhoc.html` (nếu dùng VS Code Live Server)
- Hoặc mở file trực tiếp: `file:///C:/Users/.../monhoc.html`

---

## 📋 Danh Sách API Endpoints

| Endpoint | Mô tả | Method |
|----------|-------|--------|
| `/api/monhoc` | Danh sách môn học | GET |
| `/api/lop` | Danh sách lớp học | GET |
| `/api/giangvien` | Danh sách giảng viên | GET |
| `/api/phonghoc` | Danh sách phòng học | GET |

---

## 🐛 Troubleshooting

### Lỗi: "Cannot find module '@supabase/supabase-js'"
```bash
npm install @supabase/supabase-js
```

### Lỗi: "Port 3000 already in use"
```bash
# Tìm process đang chạy trên port 3000
netstat -ano | findstr :3000

# Kill process (thay PID bằng ID thực tế)
taskkill /PID <PID> /F
```

### Lỗi: "Supabase connection failed"
- Kiểm tra `.env.local` có đúng URL không
- Kiểm tra kết nối internet
- Kiểm tra Supabase project còn hoạt động không

### Trang web vẫn hiện "Máy chủ không hoạt động"
- Đảm bảo server chạy ở cổng 3000
- Thử reload trang: `Ctrl + Shift + R`
- Kiểm tra browser console (F12) để xem lỗi chi tiết

---

## 📌 Lưu Ý

- **Khi sử dụng mock data**: Các thay đổi sẽ bị mất khi reload trang
- **Khi sử dụng backend**: Dữ liệu sẽ được lưu vào Supabase
- **CORS đã được bật** trong `server.js`, nên không cần lo về CORS errors

---

## 📞 Liên Hệ & Hỗ Trợ

Nếu vẫn gặp vấn đề:
1. Kiểm tra console browser (F12 → Console)
2. Xem chi tiết lỗi trong terminal nơi chạy `node server.js`
3. Đảm bảo firewall không chặn port 3000

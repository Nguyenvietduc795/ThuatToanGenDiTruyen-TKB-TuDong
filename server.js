const express = require('express');
const cors = require('cors');
// Bước tiếp theo sau khi cài Node.js sẽ là dùng cái này để nối Supabase
// const { createClient } = require('@supabase/supabase-js'); 

const app = express();
app.use(cors());
app.use(express.json());

// Dữ liệu mẫu (Mock Data) khớp 100% với Database và Giao diện của bạn
const giangVienData = [
    { 
        MaGV: "GV001", 
        TenGV: "Nguyễn Minh Khoa", 
        Email: "nmkhoa@dnc.edu.vn", 
        SDT: "0901 234 567", 
        HocVi: "Thạc sĩ", 
        ChuyenMon: "Công nghệ thông tin", 
        TrangThai: "Đang giảng dạy" 
    },
    { 
        MaGV: "GV002", 
        TenGV: "Trương Hùng Chen", 
        Email: "thchen@dnc.edu.vn", 
        SDT: "0908 765 432", 
        HocVi: "Tiến sĩ", 
        ChuyenMon: "Hệ quản trị CSDL", 
        TrangThai: "Tạm ngưng" 
    }
];

// API trả về danh sách giảng viên
app.get('/api/giangvien', (req, res) => {
    res.json(giangVienData);
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`[Backend] Server đang chạy tại: http://localhost:${PORT}`);
    console.log(`[API] Truy cập để xem dữ liệu: http://localhost:${PORT}/api/giangvien`);
});

// Thêm đoạn này vào dưới route /api/giangvien trong server.js
const monHocData = [
    { MaMon: "IT001", TenMon: "Lập trình Web", SoTinChi: 3, LoaiPhong: "Phòng máy" }
];

app.get('/api/monhoc', (req, res) => {
    res.json(monHocData);
});
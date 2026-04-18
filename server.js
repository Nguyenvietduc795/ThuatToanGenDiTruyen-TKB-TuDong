const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));   // serve HTML/CSS/JS tĩnh

// ── Load mock_data.json một lần khi khởi động ──────────────────────────────
const raw = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'test_files', 'mock_data.json'), 'utf-8')
);

// ── Map helpers ─────────────────────────────────────────────────────────────
function mapHocVi(hv) {
    if (hv === 'ThS')  return 'Thạc sĩ';
    if (hv === 'TS')   return 'Tiến sĩ';
    if (hv === 'GS.TS') return 'Giáo sư - Tiến sĩ';
    return hv;
}
function mapLoaiPhong(lp) {
    return lp === 'TH' ? 'Phòng máy' : 'Lý thuyết';
}
function mapTrangThaiGV(tt) {
    return tt === 'active' ? 'Đang giảng dạy' : 'Tạm ngưng';
}
function mapTrangThaiPhong(tt) {
    return tt === 'active' ? 'Sẵn sàng' : 'Đang bảo trì';
}

// ── In-memory stores (khởi tạo từ mock_data) ────────────────────────────────
let giangVienStore = raw.giang_vien.map(gv => ({
    MaGV      : gv.magv,
    TenGV     : gv.tengv,
    Email     : gv.email,
    SDT       : gv.sdt,
    HocVi     : mapHocVi(gv.hocvi),
    ChuyenMon : gv.chuyenmon,
    TrangThai : mapTrangThaiGV(gv.trangthai),
}));

let monHocStore = raw.mon_hoc.map(m => ({
    MaMon     : m.mamon,
    TenMon    : m.tenmon,
    SoTinChi  : m.sotinchi,
    TongSoTiet: m.tongsotiet,
    SoTietLT  : m.sotietlythuyet,
    SoTietTH  : m.sotietthuchanh,
    LoaiPhong : mapLoaiPhong(m.loaiphong),
}));

let lopStore = raw.lop.map(l => ({
    MaLop  : l.malop,
    TenLop : l.tenlop,
    MaKhoa : l.makhoa,
}));

let phongStore = raw.phong_hoc.map(p => ({
    MaPhong  : p.maphong,
    TenPhong : p.tenphong,
    LoaiPhong: mapLoaiPhong(p.loaiphong),
    TrangThai: mapTrangThaiPhong(p.trangthai),
}));

// ── Tiện ích sinh mã tự tăng ─────────────────────────────────────────────────
function nextCode(store, field, prefix, pad) {
    const nums = store
        .map(item => parseInt(item[field].replace(prefix, '')))
        .filter(n => !isNaN(n));
    const max = nums.length ? Math.max(...nums) : 0;
    return prefix + (max + 1).toString().padStart(pad, '0');
}

// ════════════════════════════════════════════════════════════════════════════
// API: Giảng viên  /api/giangvien
// ════════════════════════════════════════════════════════════════════════════
app.get('/api/giangvien', (req, res) => res.json(giangVienStore));

app.post('/api/giangvien', (req, res) => {
    const gv = { ...req.body, MaGV: nextCode(giangVienStore, 'MaGV', 'GV', 2) };
    giangVienStore.push(gv);
    res.status(201).json(gv);
});

app.put('/api/giangvien/:ma', (req, res) => {
    const idx = giangVienStore.findIndex(g => g.MaGV === req.params.ma);
    if (idx === -1) return res.status(404).json({ error: 'Không tìm thấy' });
    giangVienStore[idx] = { ...req.body, MaGV: req.params.ma };
    res.json(giangVienStore[idx]);
});

app.delete('/api/giangvien/:ma', (req, res) => {
    giangVienStore = giangVienStore.filter(g => g.MaGV !== req.params.ma);
    res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════════════
// API: Môn học  /api/monhoc
// ════════════════════════════════════════════════════════════════════════════
app.get('/api/monhoc', (req, res) => res.json(monHocStore));

app.post('/api/monhoc', (req, res) => {
    const mh = { ...req.body, MaMon: nextCode(monHocStore, 'MaMon', 'M', 2) };
    monHocStore.push(mh);
    res.status(201).json(mh);
});

app.put('/api/monhoc/:ma', (req, res) => {
    const idx = monHocStore.findIndex(m => m.MaMon === req.params.ma);
    if (idx === -1) return res.status(404).json({ error: 'Không tìm thấy' });
    monHocStore[idx] = { ...req.body, MaMon: req.params.ma };
    res.json(monHocStore[idx]);
});

app.delete('/api/monhoc/:ma', (req, res) => {
    monHocStore = monHocStore.filter(m => m.MaMon !== req.params.ma);
    res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════════════
// API: Lớp học  /api/lop
// ════════════════════════════════════════════════════════════════════════════
app.get('/api/lop', (req, res) => res.json(lopStore));

app.post('/api/lop', (req, res) => {
    const lop = { ...req.body, MaLop: nextCode(lopStore, 'MaLop', 'L', 2) };
    lopStore.push(lop);
    res.status(201).json(lop);
});

app.put('/api/lop/:ma', (req, res) => {
    const idx = lopStore.findIndex(l => l.MaLop === req.params.ma);
    if (idx === -1) return res.status(404).json({ error: 'Không tìm thấy' });
    lopStore[idx] = { ...req.body, MaLop: req.params.ma };
    res.json(lopStore[idx]);
});

app.delete('/api/lop/:ma', (req, res) => {
    lopStore = lopStore.filter(l => l.MaLop !== req.params.ma);
    res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════════════
// API: Phòng học  /api/phonghoc
// ════════════════════════════════════════════════════════════════════════════
app.get('/api/phonghoc', (req, res) => res.json(phongStore));

app.post('/api/phonghoc', (req, res) => {
    const phong = { ...req.body, MaPhong: nextCode(phongStore, 'MaPhong', 'P', 3) };
    phongStore.push(phong);
    res.status(201).json(phong);
});

app.put('/api/phonghoc/:ma', (req, res) => {
    const idx = phongStore.findIndex(p => p.MaPhong === req.params.ma);
    if (idx === -1) return res.status(404).json({ error: 'Không tìm thấy' });
    phongStore[idx] = { ...req.body, MaPhong: req.params.ma };
    res.json(phongStore[idx]);
});

app.delete('/api/phonghoc/:ma', (req, res) => {
    phongStore = phongStore.filter(p => p.MaPhong !== req.params.ma);
    res.json({ ok: true });
});

// ── Start ───────────────────────────────────────────────────────────────────
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`[BE] http://localhost:${PORT}`);
    console.log(`  GET /api/giangvien | /api/monhoc | /api/lop | /api/phonghoc`);
});

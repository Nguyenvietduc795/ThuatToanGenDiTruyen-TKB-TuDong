const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

app.get('/api/giangvien', async (req, res) => {
  const { data, error } = await supabase
    .from('giang_vien')
    .select('*');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/api/lop', async (req, res) => {
  const { data, error } = await supabase
    .from('lop')
    .select('malop, tenlop, khoa');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/api/monhoc', async (req, res) => {
  const { data, error } = await supabase
    .from('mon_hoc')
    .select('mamon, tenmon, sotinchi, tongsotiet, sotietlythuyet, sotietthuchanh, loaiphong');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/api/phonghoc', async (req, res) => {
  const { data, error } = await supabase
    .from('phong_hoc')
    .select('maphong, tenphong, loaiphong, trangthai');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[Backend] Server đang chạy tại: http://localhost:${PORT}`);
  console.log(`[API] Giảng viên: http://localhost:${PORT}/api/giangvien`);
  console.log(`[API] Lớp: http://localhost:${PORT}/api/lop`);
  console.log(`[API] Môn học: http://localhost:${PORT}/api/monhoc`);
  console.log(`[API] Phòng học: http://localhost:${PORT}/api/phonghoc`);
});


const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
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

const PYTHON_EXECUTABLE = process.env.PYTHON_EXECUTABLE || 'python';
const DAY_ALIASES = {
  0: ['monday', 'thu 2', 'thứ 2', '2'],
  1: ['tuesday', 'thu 3', 'thứ 3', '3'],
  2: ['wednesday', 'thu 4', 'thứ 4', '4'],
  3: ['thursday', 'thu 5', 'thứ 5', '5'],
  4: ['friday', 'thu 6', 'thứ 6', '6'],
  5: ['saturday', 'thu 7', 'thứ 7', '7'],
};

function stripVietnamese(input) {
  if (input === null || input === undefined) return '';
  return String(input)
    .trim()
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_]+/g, '');
}

function normalizeRoomType(value) {
  const text = stripVietnamese(value);
  if (['lt', 'lythuyet', 'theory'].includes(text)) {
    return 'LT';
  }
  if (['th', 'thuchanh', 'phongmay', 'phongmaytinh', 'lab'].includes(text)) {
    return 'TH';
  }
  return String(value || '').trim().toUpperCase();
}

function normalizeDayValue(rawValue) {
  if (rawValue === null || rawValue === undefined) return '';
  return String(rawValue).trim().toLowerCase();
}

function mapDayToIndex(rawDay) {
  const day = normalizeDayValue(rawDay);
  for (const [idx, aliases] of Object.entries(DAY_ALIASES)) {
    if (aliases.includes(day)) {
      return Number(idx);
    }
  }
  return null;
}

function normalizeStatus(row) {
  return stripVietnamese(row?.trangthai || 'active');
}

function normalizeAssignmentType(pc, subjectsById) {
  if (pc.loaiphong) {
    return normalizeRoomType(pc.loaiphong);
  }

  const mon = subjectsById.get(pc.mamon);
  if (!mon) {
    return 'LT';
  }

  if (Number(mon.sotietlythuyet || 0) === 0 && Number(mon.sotietthuchanh || 0) > 0) {
    return 'TH';
  }
  if (Number(mon.sotietthuchanh || 0) === 0 && Number(mon.sotietlythuyet || 0) > 0) {
    return 'LT';
  }
  if (mon.loaiphong) {
    return normalizeRoomType(mon.loaiphong);
  }
  return 'LT';
}

async function getSupabaseGaInput({ hocky = null, namhoc = null } = {}) {
  const [gvRes, lopRes, monRes, phongRes, khungRes, pcRes] = await Promise.all([
    supabase.from('giang_vien').select('*'),
    supabase.from('lop').select('*'),
    supabase.from('mon_hoc').select('*'),
    supabase.from('phong_hoc').select('*'),
    supabase.from('khung_thoi_gian').select('*'),
    supabase.from('phan_cong_giang_day').select('*'),
  ]);

  const errors = [gvRes.error, lopRes.error, monRes.error, phongRes.error, khungRes.error, pcRes.error]
    .filter(Boolean);
  if (errors.length > 0) {
    throw new Error(errors.map((e) => e.message).join(' | '));
  }

  const subjectsById = new Map((monRes.data || []).map((m) => [m.mamon, m]));
  let assignments = (pcRes.data || []).map((pc) => ({
    ...pc,
    loaiphong: normalizeAssignmentType(pc, subjectsById),
  }));

  if (hocky !== null && hocky !== undefined) {
    assignments = assignments.filter((pc) => Number(pc.hocky) === Number(hocky));
  }
  if (namhoc) {
    assignments = assignments.filter((pc) => String(pc.namhoc) === String(namhoc));
  }

  return {
    rawData: {
      giang_vien: gvRes.data || [],
      lop: lopRes.data || [],
      mon_hoc: monRes.data || [],
      phong_hoc: phongRes.data || [],
      khung_thoi_gian: khungRes.data || [],
      phan_cong_giang_day: assignments,
    },
    khungThoiGian: khungRes.data || [],
  };
}

function buildKhungMap(khungRows) {
  const map = new Map();
  for (const row of khungRows) {
    const status = normalizeStatus(row);
    if (!['active', 'hoatdong', 'available', 'ready', 'sansang', 'ranh', '1', 'true'].includes(status)) continue;
    const dayIndex = mapDayToIndex(row.thutrongtuan);
    if (dayIndex === null) continue;

    const start = Number(row.tietbatdau);
    const end = Number(row.tietketthuc || row.tietbatdau);
    for (let slot = start; slot <= end; slot += 1) {
      const key = `${dayIndex}-${slot}`;
      if (!map.has(key)) {
        map.set(key, row.makhung);
      }
    }
  }
  return map;
}

function runGaPython(payload) {
  const result = spawnSync(
    PYTHON_EXECUTABLE,
    ['ga_cli.py'],
    {
      cwd: __dirname,
      input: JSON.stringify(payload),
      encoding: 'utf-8',
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
      },
      maxBuffer: 1024 * 1024 * 8,
    }
  );

  if (result.error) {
    throw result.error;
  }

  const stdout = String(result.stdout || '').trim();
  const stderr = String(result.stderr || '').trim();
  let parsed = null;
  if (stdout) {
    try {
      parsed = JSON.parse(stdout);
    } catch {
      parsed = null;
    }
  }

  if (result.status !== 0) {
    if (parsed?.error) {
      throw new Error(parsed.error);
    }
    throw new Error(stderr || stdout || 'Python GA process failed');
  }

  if (!parsed?.ok) {
    throw new Error(parsed?.error || 'Python GA did not return successful result');
  }

  return parsed.result;
}

function parseOptionalNumber(value, fieldName) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} phai la so hop le`);
  }
  return parsed;
}

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

app.get('/api/phan-cong', async (req, res) => {
  try {
    let query = supabase.from('phan_cong_giang_day').select('*');
    if (req.query.malop)  query = query.eq('malop',  String(req.query.malop));
    if (req.query.mamon)  query = query.eq('mamon',  String(req.query.mamon));
    if (req.query.hocky)  query = query.eq('hocky',  Number(req.query.hocky));
    if (req.query.namhoc) query = query.eq('namhoc', String(req.query.namhoc));
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/tkb', async (req, res) => {
  try {
    const tuanhoc = parseOptionalNumber(req.query.tuanhoc, 'tuanhoc');
    const hocky = parseOptionalNumber(req.query.hocky, 'hocky');
    const namhoc = req.query.namhoc ? String(req.query.namhoc) : null;
    const mapc = req.query.mapc ? String(req.query.mapc) : null;

    let filterMapc = null;
    if (hocky !== null || namhoc) {
      let pcQuery = supabase.from('phan_cong_giang_day').select('mapc');
      if (hocky !== null) {
        pcQuery = pcQuery.eq('hocky', hocky);
      }
      if (namhoc) {
        pcQuery = pcQuery.eq('namhoc', namhoc);
      }
      const { data: pcs, error: pcError } = await pcQuery;
      if (pcError) {
        throw new Error(pcError.message);
      }
      filterMapc = (pcs || []).map((item) => item.mapc);
      if (filterMapc.length === 0) {
        return res.json([]);
      }
    }

    let query = supabase
      .from('thoi_khoa_bieu')
      .select('*')
      .order('tuanhoc', { ascending: true })
      .order('mapc', { ascending: true });

    if (tuanhoc !== null) {
      query = query.eq('tuanhoc', tuanhoc);
    }
    if (mapc) {
      query = query.eq('mapc', mapc);
    }
    if (filterMapc) {
      query = query.in('mapc', filterMapc);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(error.message);
    }
    return res.json(data || []);
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get('/api/ga/input-summary', async (req, res) => {
  try {
    const hocky = parseOptionalNumber(req.query.hocky, 'hocky');
    const namhoc = req.query.namhoc ? String(req.query.namhoc) : null;

    const { rawData } = await getSupabaseGaInput({ hocky, namhoc });
    return res.json({
      ok: true,
      filters: { hocky, namhoc },
      counts: {
        giang_vien: (rawData.giang_vien || []).length,
        lop: (rawData.lop || []).length,
        mon_hoc: (rawData.mon_hoc || []).length,
        phong_hoc: (rawData.phong_hoc || []).length,
        phan_cong_giang_day: (rawData.phan_cong_giang_day || []).length,
      },
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get('/api/ga/mon-status', async (req, res) => {
  try {
    const [pcRes, monRes, tkbRes] = await Promise.all([
      supabase.from('phan_cong_giang_day').select('mapc, malop, mamon, sobuoimoituan, sotietmoibuoi'),
      supabase.from('mon_hoc').select('mamon, tongsotiet'),
      supabase.from('thoi_khoa_bieu').select('mapc'),
    ]);
    const monMap = new Map((monRes.data || []).map(m => [m.mamon, m]));
    const scheduledCount = {};
    for (const row of tkbRes.data || []) {
      scheduledCount[row.mapc] = (scheduledCount[row.mapc] || 0) + 1;
    }
    const result = (pcRes.data || []).map(pc => {
      const tongsotiet = Number(monMap.get(pc.mamon)?.tongsotiet || 0);
      const scheduled  = scheduledCount[pc.mapc] || 0;
      const remaining  = Math.max(0, tongsotiet - scheduled);
      return {
        mapc: pc.mapc, malop: pc.malop, mamon: pc.mamon,
        sobuoimoituan: pc.sobuoimoituan, sotietmoibuoi: pc.sotietmoibuoi,
        tongsotiet, scheduled, remaining,
        exhausted: tongsotiet > 0 && remaining === 0,
      };
    });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/ga/generate', async (req, res) => {
  try {
    const {
      hocky = null,
      namhoc = null,
      tuanhoc = 1,
      persist = true,
      popSize = 20,
      maxGen = 500,
    } = req.body || {};

    const parsedTuanhoc = Number(tuanhoc);
    const parsedPopSize = Number(popSize);
    const parsedMaxGen = Number(maxGen);
    if (!Number.isInteger(parsedTuanhoc) || parsedTuanhoc <= 0) {
      return res.status(400).json({ ok: false, error: 'tuanhoc phai la so nguyen > 0' });
    }
    if (!Number.isInteger(parsedPopSize) || parsedPopSize <= 0) {
      return res.status(400).json({ ok: false, error: 'popSize phai la so nguyen > 0' });
    }
    if (!Number.isInteger(parsedMaxGen) || parsedMaxGen <= 0) {
      return res.status(400).json({ ok: false, error: 'maxGen phai la so nguyen > 0' });
    }

    const { rawData, khungThoiGian } = await getSupabaseGaInput({ hocky, namhoc });

    // ── Lọc theo malop/mamon (hỗ trợ cả string lẫn array) ───────────────
    const malops = [].concat(req.body.malop || []).map(String).filter(Boolean);
    const mamons = [].concat(req.body.mamon || []).map(String).filter(Boolean);
    if (malops.length > 0) {
      rawData.phan_cong_giang_day = (rawData.phan_cong_giang_day || []).filter(
        (pc) => malops.includes(pc.malop)
      );
    }
    if (mamons.length > 0) {
      rawData.phan_cong_giang_day = (rawData.phan_cong_giang_day || []).filter(
        (pc) => mamons.includes(pc.mamon)
      );
    }

    // ── Enforce session rules + loại bỏ phân công đã hoàn thành ──────────
    // Dùng week-based check thay vì đếm DB rows:
    //   so_tuan_can_hoc = ceil(tongsotiet / (sobuoimoituan * sotietmoibuoi))
    //   Nếu parsedTuanhoc > so_tuan_can_hoc → học phần đã xong, bỏ qua.
    // Ưu điểm: O(n), không cần query DB, deterministic.
    const monMap = new Map((rawData.mon_hoc || []).map((m) => [m.mamon, m]));
    console.log(`[GA] mon_hoc keys: ${[...monMap.keys()].join(', ')}`);
    console.log(`[GA] phan_cong mamons: ${[...new Set((rawData.phan_cong_giang_day||[]).map(p=>p.mamon))].join(', ')}`);

    // Bước 1: enforce session rules (sotietmoibuoi=5 → sobuoimoituan=1)
    rawData.phan_cong_giang_day = (rawData.phan_cong_giang_day || []).map((pc) => {
      const sotietmoibuoi = Number(pc.sotietmoibuoi) || 3;
      const sobuoimoituan = sotietmoibuoi === 5
        ? 1
        : Math.min(2, Math.max(1, Number(pc.sobuoimoituan) || 1));
      return { ...pc, sobuoimoituan, sotietmoibuoi };
    });

    // Bước 2: lọc theo week-based stopping point
    const before = (rawData.phan_cong_giang_day || []).length;
    rawData.phan_cong_giang_day = (rawData.phan_cong_giang_day || []).filter((pc) => {
      const mon = monMap.get(pc.mamon);
      const tongsotiet = Number(mon?.tongsotiet || 0);
      if (tongsotiet <= 0) return true; // không giới hạn → luôn xếp

      const tietsPerWeek = pc.sobuoimoituan * pc.sotietmoibuoi;
      if (tietsPerWeek <= 0) return true;

      const soTuanCanHoc = Math.ceil(tongsotiet / tietsPerWeek);
      return parsedTuanhoc <= soTuanCanHoc;
    });
    const exhausted = before - (rawData.phan_cong_giang_day || []).length;
    if (exhausted > 0) {
      console.log(`[GA] Loai bo ${exhausted} phan cong da het so_tuan_can_hoc.`);
    }

    if ((rawData.phan_cong_giang_day || []).length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'Khong co phan_cong_giang_day phu hop (het tongsotiet hoac khong co du lieu)',
        filters: { hocky, namhoc, malop: malops, mamon: mamons },
        counts: {
          giang_vien: (rawData.giang_vien || []).length,
          lop: (rawData.lop || []).length,
          mon_hoc: (rawData.mon_hoc || []).length,
          phong_hoc: (rawData.phong_hoc || []).length,
          phan_cong_giang_day: 0,
        },
      });
    }

    const gaResult = runGaPython({
      raw_data: rawData,
      pop_size: parsedPopSize,
      max_gen: parsedMaxGen,
      file_name: `supabase_hk${hocky ?? 'all'}_nh${namhoc ?? 'all'}.json`,
      tuanhoc: parsedTuanhoc, // Python dùng để double-check so_tuan_can_hoc
    });

    const sessions = gaResult.sessions || [];
    const summary = gaResult.summary || {};
    const khungMap = buildKhungMap(khungThoiGian);

    // ── Tính số tuần cần học cho từng mapc ───────────────────────────────
    // GA tạo pattern 1 tuần → nhân ra TẤT CẢ tuần cần thiết theo tongsotiet.
    // Ví dụ: môn 45t, 2 buổi/tuần × 3t/buổi → 8 tuần → lưu tuanhoc 1..8 cùng lúc.
    const pcWeeksMap = new Map(); // mapc → so_tuan_can_hoc
    for (const pc of rawData.phan_cong_giang_day || []) {
      const mon = monMap.get(pc.mamon);
      // Ưu tiên tongsotiet từ pc (nếu có denormalized), rồi mới tra monMap
      const tongsotiet    = Number(pc.tongsotiet || mon?.tongsotiet || 0);
      const tietsPerWeek  = Number(pc.sobuoimoituan) * Number(pc.sotietmoibuoi);
      const soTuanCanHoc  = (tongsotiet > 0 && tietsPerWeek > 0)
        ? Math.ceil(tongsotiet / tietsPerWeek)
        : 1;
      console.log(`[WEEKS] mapc=${pc.mapc} mamon=${pc.mamon} tongsotiet=${tongsotiet} tietsPerWeek=${tietsPerWeek} soTuanCanHoc=${soTuanCanHoc}`);
      pcWeeksMap.set(pc.mapc, soTuanCanHoc);
    }

    // ── Build rows cho tuần gốc (parsedTuanhoc) ──────────────────────────
    const baseRows = []; // pattern của 1 tuần
    for (const session of sessions) {
      for (const slot of session.slot_numbers || []) {
        const key     = `${session.day_index}-${slot}`;
        const makhung = khungMap.get(key);
        if (!makhung) {
          throw new Error(`Khong map duoc makhung cho day_index=${session.day_index}, slot=${slot}`);
        }
        baseRows.push({ mapc: session.mapc, maphong: session.maphong, makhung });
      }
    }

    // ── Nhân pattern ra tất cả tuần cần thiết ───────────────────────────
    const allRows = [];
    for (const row of baseRows) {
      const soTuan = pcWeeksMap.get(row.mapc) || 1;
      for (let w = parsedTuanhoc; w < parsedTuanhoc + soTuan; w++) {
        allRows.push({
          matkb:   crypto.randomUUID(),
          tuanhoc: w,
          mapc:    row.mapc,
          maphong: row.maphong,
          makhung: row.makhung,
        });
      }
    }

    const maxWeek = allRows.length > 0 ? Math.max(...allRows.map(r => r.tuanhoc)) : parsedTuanhoc;
    console.log(`[GA] baseRows=${baseRows.length} allRows=${allRows.length} maxWeek=${maxWeek} parsedTuanhoc=${parsedTuanhoc}`);

    if (persist) {
      const existingMapc = [...new Set((rawData.phan_cong_giang_day || []).map((pc) => pc.mapc))];
      if (existingMapc.length > 0) {
        // Xóa TẤT CẢ tuần cũ của các mapc này (không chỉ tuanhoc hiện tại)
        const { error: deleteError } = await supabase
          .from('thoi_khoa_bieu')
          .delete()
          .in('mapc', existingMapc);
        if (deleteError) throw new Error(deleteError.message);
      }

      // Insert theo batch 500 rows để tránh giới hạn Supabase
      const BATCH = 500;
      for (let i = 0; i < allRows.length; i += BATCH) {
        const { error: insertError } = await supabase
          .from('thoi_khoa_bieu')
          .insert(allRows.slice(i, i + BATCH));
        if (insertError) throw new Error(insertError.message);
      }
    }

    return res.json({
      ok: true,
      summary,
      filters: { hocky, namhoc, tuanhoc: parsedTuanhoc, popSize: parsedPopSize, maxGen: parsedMaxGen },
      persisted: Boolean(persist),
      generatedRows:     allRows.length,
      generatedSessions: sessions.length,
      weeksGenerated:    maxWeek - parsedTuanhoc + 1,
      weekRange:         { from: parsedTuanhoc, to: maxWeek },
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get('/api/tkb/viewer', async (req, res) => {
  try {
    const tuanhoc = parseOptionalNumber(req.query.tuanhoc, 'tuanhoc') ?? 1;
    const hocky   = parseOptionalNumber(req.query.hocky, 'hocky');
    const namhoc  = req.query.namhoc ? String(req.query.namhoc) : null;

    const [tkbRes, gvRes, lopRes, monRes, phongRes, pcRes, khungRes] = await Promise.all([
      supabase.from('thoi_khoa_bieu').select('*').eq('tuanhoc', tuanhoc),
      supabase.from('giang_vien').select('*'),
      supabase.from('lop').select('*'),
      supabase.from('mon_hoc').select('*'),
      supabase.from('phong_hoc').select('*'),
      supabase.from('phan_cong_giang_day').select('*'),
      supabase.from('khung_thoi_gian').select('*'),
    ]);

    const errs = [tkbRes.error, gvRes.error, lopRes.error, monRes.error, phongRes.error, pcRes.error, khungRes.error].filter(Boolean);
    if (errs.length) throw new Error(errs.map((e) => e.message).join(' | '));

    // Build lookup maps
    const gvMap  = new Map((gvRes.data  || []).map((g) => [g.magv,  g]));
    const lopMap = new Map((lopRes.data || []).map((l) => [l.malop, l]));
    const monMap = new Map((monRes.data || []).map((m) => [m.mamon, m]));

    // Build pc map (filter hocky/namhoc if provided)
    let pcRows = pcRes.data || [];
    if (hocky  !== null) pcRows = pcRows.filter((p) => Number(p.hocky) === hocky);
    if (namhoc)          pcRows = pcRows.filter((p) => String(p.namhoc) === namhoc);
    const pcMap = new Map(pcRows.map((p) => [p.mapc, p]));

    // Build khung map: makhung -> { day_index, slot }
    const khungMap = new Map();
    for (const k of khungRes.data || []) {
      const dayIdx = mapDayToIndex(k.thutrongtuan);
      if (dayIdx !== null) khungMap.set(k.makhung, { day_index: dayIdx, slot: Number(k.tietbatdau) });
    }

    // Group thoi_khoa_bieu rows into sessions by (mapc, maphong, day_index)
    const sessMap = new Map();
    for (const row of tkbRes.data || []) {
      if (!pcMap.has(row.mapc)) continue;        // filtered out by hocky/namhoc
      const khung = khungMap.get(row.makhung);
      if (!khung) continue;
      const key = `${row.mapc}|${row.maphong}|${khung.day_index}`;
      if (!sessMap.has(key)) sessMap.set(key, { mapc: row.mapc, maphong: row.maphong, day_index: khung.day_index, slots: [] });
      sessMap.get(key).slots.push(khung.slot);
    }

    // Build lich array
    const lich = [];
    for (const sess of sessMap.values()) {
      sess.slots.sort((a, b) => a - b);
      const pc  = pcMap.get(sess.mapc);
      const gv  = gvMap.get(pc.magv)   || {};
      const lop = lopMap.get(pc.malop)  || {};
      const mon = monMap.get(pc.mamon)  || {};
      const loai = normalizeAssignmentType(pc, monMap);
      lich.push({
        thu_idx:   sess.day_index,
        tiet_start: sess.slots[0],
        tiet_end:   sess.slots[sess.slots.length - 1],
        mamon:  pc.mamon,
        tenmon: mon.tenmon  || pc.mamon,
        magv:   pc.magv,
        tengv:  gv.tengv    || pc.magv,
        malop:  pc.malop,
        tenlop: lop.tenlop  || pc.malop,
        maphong: sess.maphong,
        loai,
      });
    }

    return res.json({
      ok:       true,
      tuanhoc,
      lich,
      gv_list:    (gvRes.data  || []).map((g) => ({ magv: g.magv,   tengv: g.tengv,   hocvi: g.hocvi })),
      lop_list:   (lopRes.data || []).map((l) => ({ malop: l.malop, tenlop: l.tenlop })),
      phong_list: (phongRes.data || []).map((p) => ({ maphong: p.maphong, tenphong: p.tenphong, loaiphong: normalizeRoomType(p.loaiphong) })),
      mon_list:   (monRes.data || []).map((m) => ({ mamon: m.mamon, sotietlythuyet: m.sotietlythuyet, sotietthuchanh: m.sotietthuchanh })),
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

async function autoSeedIfEmpty() {
  try {
    const { count: khungCount } = await supabase
      .from('khung_thoi_gian').select('*', { count: 'exact', head: true });
    const { count: pcCount } = await supabase
      .from('phan_cong_giang_day').select('*', { count: 'exact', head: true });

    const needsKhung = !khungCount || khungCount === 0;
    const needsPC    = !pcCount    || pcCount    === 0;

    if (needsKhung || needsPC) {
      console.log('[AutoSeed] Phat hien bang trong, dang seed...');
      const { spawnSync } = require('child_process');
      if (needsKhung) {
        spawnSync('node', ['scripts/bootstrap_time_slots.js'],  { stdio: 'inherit' });
      }
      if (needsPC) {
        spawnSync('node', ['scripts/bootstrap_assignments.js'], { stdio: 'inherit' });
      }
      console.log('[AutoSeed] Hoan thanh.');
    } else {
      console.log(`[AutoSeed] Du lieu OK: ${khungCount} khung, ${pcCount} phan_cong.`);
    }
  } catch (e) {
    console.warn('[AutoSeed] Khong the kiem tra / seed tu dong:', e.message);
  }
}

app.listen(PORT, async () => {
  console.log(`[Backend] Server đang chạy tại: http://localhost:${PORT}`);
  console.log(`[API] Giảng viên: http://localhost:${PORT}/api/giangvien`);
  console.log(`[API] Lớp: http://localhost:${PORT}/api/lop`);
  console.log(`[API] Môn học: http://localhost:${PORT}/api/monhoc`);
  console.log(`[API] Phòng học: http://localhost:${PORT}/api/phonghoc`);
  console.log(`[API] Lấy TKB: http://localhost:${PORT}/api/tkb`);
  console.log(`[API] Kiem tra input GA: http://localhost:${PORT}/api/ga/input-summary`);
  console.log(`[API] Sinh TKB (GA): http://localhost:${PORT}/api/ga/generate`);
  await autoSeedIfEmpty();
});


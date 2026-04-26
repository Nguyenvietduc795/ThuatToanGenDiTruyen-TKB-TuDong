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
  6: ['sunday', 'chu nhat', 'chủ nhật', 'cn', '8'],
};

function stripVietnamese(input) {
  if (input === null || input === undefined) return '';
  return String(input)
    .trim()
    .toLowerCase()
    .replace(/[đĐ]/g, 'd')
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_]+/g, '');
}

function subjectBaseKey(name) {
  const key = stripVietnamese(name).replace(/[-–—]+/g, '');
  return key.endsWith('thuchanh') ? key.slice(0, -'thuchanh'.length) : key;
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
  // Ưu tiên 1: loaiphong đã được ghi trực tiếp trong phan_cong_giang_day
  if (pc.loaiphong) {
    return normalizeRoomType(pc.loaiphong);
  }

  // Ưu tiên 2: suffix của mamon (_TH → thực hành, _LT → lý thuyết)
  // Đây là cách đáng tin nhất vì bootstrap luôn tạo mamon theo quy tắc này.
  const mamonUpper = String(pc.mamon || '').toUpperCase();
  if (mamonUpper.endsWith('_TH')) return 'TH';
  if (mamonUpper.endsWith('_LT')) return 'LT';

  // Ưu tiên 3: số tiết trong mon_hoc
  const mon = subjectsById.get(pc.mamon);
  if (mon) {
    const lt = Number(mon.sotietlythuyet || 0);
    const th = Number(mon.sotietthuchanh || 0);
    if (lt === 0 && th > 0) return 'TH';
    if (th === 0 && lt > 0) return 'LT';
    if (mon.loaiphong) return normalizeRoomType(mon.loaiphong);
  }

  return 'LT';
}

async function getSupabaseGaInput({ mahk = null, namhoc = null } = {}) {
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

  // Soft filter theo mahk/namhoc: chỉ áp dụng nếu có kết quả sau lọc
  if (mahk !== null) {
    const filtered = assignments.filter((pc) => pc.mahk != null && Number(pc.mahk) === Number(mahk));
    if (filtered.length > 0) assignments = filtered;
  }
  if (namhoc) {
    const filtered = assignments.filter((pc) => pc.namhoc && String(pc.namhoc) === String(namhoc));
    if (filtered.length > 0) assignments = filtered;
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

function firstValue(body, keys) {
  for (const key of keys) {
    if (body[key] !== undefined && body[key] !== null) {
      return body[key];
    }
  }
  return undefined;
}

function optionalText(value) {
  return value === undefined || value === null ? null : String(value).trim();
}

function parseBodyNumber(value, fieldName) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${fieldName} phai la so khong am`);
  }
  return parsed;
}

async function generateNextCode(tableName, columnName, prefix, width) {
  const { data, error } = await supabase.from(tableName).select(columnName);
  if (error) throw new Error(error.message);

  const maxNumber = (data || []).reduce((max, row) => {
    const value = String(row[columnName] || '');
    const match = value.match(new RegExp(`^${prefix}(\\d+)$`, 'i'));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  return `${prefix}${String(maxNumber + 1).padStart(width, '0')}`;
}

function sendSupabaseError(res, error) {
  return res.status(400).json({ ok: false, error: error.message });
}

function normalizeScheduleStatus(value) {
  return String(value || 'DANG_HOC').trim().toUpperCase();
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return !(Number(aEnd) < Number(bStart) || Number(aStart) > Number(bEnd));
}

function sameCode(a, b) {
  return String(a ?? '').trim().toUpperCase() === String(b ?? '').trim().toUpperCase();
}

function deriveDateDayIndex(ngayhoc) {
  if (!ngayhoc) return null;
  const d = new Date(`${ngayhoc}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const jsDay = d.getDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

function specialRoomMamons() {
  return new Set(
    (process.env.SPECIAL_TH_ROOM_MAMONS || '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
  );
}

function hasRelatedPracticeSubject(mon, monMap) {
  if (!mon?.tenmon || !monMap) return false;
  const base = subjectBaseKey(mon.tenmon);
  for (const other of monMap.values()) {
    if (other?.mamon === mon.mamon) continue;
    if (subjectBaseKey(other?.tenmon || '') === base && Number(other?.sotietthuchanh || 0) > 0) {
      return true;
    }
  }
  return false;
}

function roomCompatibilityMessage(pc, mon, room, monMap = null) {
  const sessionType = normalizeAssignmentType(pc, new Map([[mon?.mamon, mon]].filter(([k]) => k)));
  const roomType = normalizeRoomType(room?.loaiphong);
  const hasPractice = Number(mon?.sotietthuchanh || 0) > 0 || hasRelatedPracticeSubject(mon, monMap);
  const specialTH = specialRoomMamons().has(String(pc?.mamon || '').toUpperCase());

  if (sessionType === 'TH' && roomType !== 'TH') {
    return 'Phòng không đúng loại yêu cầu.';
  }
  if (sessionType === 'LT') {
    if (specialTH && roomType !== 'TH') return 'Phòng không đúng loại yêu cầu.';
    if (!hasPractice && !specialTH && roomType !== 'LT') return 'Phòng không đúng loại yêu cầu.';
    if ((hasPractice || specialTH) && !['LT', 'TH'].includes(roomType)) return 'Phòng không đúng loại yêu cầu.';
  }
  return null;
}

function normalizeWeekBounds(pc) {
  const start = Number(pc?.tuanbatdau || 1);
  const end = Number(pc?.tuanketthuc || pc?.tuanbatdau || 999);
  return {
    start: Number.isFinite(start) ? start : 1,
    end: Number.isFinite(end) ? end : 999,
  };
}

function sessionDurationFromAssignment(pc, fallback = 3) {
  const raw = Number(pc?.sotietmoibuoi || fallback || 3);
  const observed = Number(fallback || 3);
  return Math.max(raw, observed) >= 5 ? 5 : 3;
}

function allowedMakeupStartSlots(duration) {
  return duration >= 5 ? [1, 7] : [1, 4, 7, 10];
}

async function fetchScheduleContext(matkb) {
  const { data: row, error: rowError } = await supabase
    .from('thoi_khoa_bieu')
    .select('*')
    .eq('matkb', matkb)
    .maybeSingle();
  if (rowError) throw new Error(rowError.message);
  if (!row) throw new Error('Không tìm thấy lịch gốc.');

  const [pcRes, monRes, roomRes, khungRes] = await Promise.all([
    supabase.from('phan_cong_giang_day').select('*').eq('mapc', row.mapc).maybeSingle(),
    supabase.from('mon_hoc').select('*'),
    supabase.from('phong_hoc').select('*'),
    supabase.from('khung_thoi_gian').select('*'),
  ]);
  const errs = [pcRes.error, monRes.error, roomRes.error, khungRes.error].filter(Boolean);
  if (errs.length) throw new Error(errs.map((e) => e.message).join(' | '));
  if (!pcRes.data) throw new Error('Không tìm thấy phân công giảng dạy của lịch gốc.');

  const monMap = new Map((monRes.data || []).map((m) => [m.mamon, m]));
  const khungMap = new Map((khungRes.data || []).map((k) => [k.makhung, {
    ...k,
    day_index: mapDayToIndex(k.thutrongtuan),
    tietbatdau: Number(k.tietbatdau),
    tietketthuc: Number(k.tietketthuc),
  }]));
  const roomMap = new Map((roomRes.data || []).map((r) => [r.maphong, r]));

  const originalKhung = khungMap.get(row.makhung);
  if (!originalKhung) throw new Error('Không tìm thấy khung thời gian của lịch gốc.');

  const { data: sameWeekRows, error: sameWeekError } = await supabase
    .from('thoi_khoa_bieu')
    .select('*')
    .eq('tuanhoc', row.tuanhoc)
    .eq('mapc', row.mapc)
    .eq('maphong', row.maphong);
  if (sameWeekError) throw new Error(sameWeekError.message);

  const sourceDay = row.ngayhoc ? deriveDateDayIndex(row.ngayhoc) : originalKhung.day_index;
  const candidateRows = (sameWeekRows || [])
    .filter((r) => {
      if (!['DANG_HOC', 'TAM_NGUNG'].includes(normalizeScheduleStatus(r.trangthai))) return false;
      const k = khungMap.get(r.makhung);
      const d = r.ngayhoc ? deriveDateDayIndex(r.ngayhoc) : k?.day_index;
      return d === sourceDay;
    })
    .sort((a, b) => (khungMap.get(a.makhung)?.tietbatdau || 0) - (khungMap.get(b.makhung)?.tietbatdau || 0));
  const originalIndex = candidateRows.findIndex((r) => r.matkb === row.matkb);
  let originalRows = candidateRows;
  if (originalIndex >= 0) {
    let left = originalIndex;
    let right = originalIndex;
    while (left > 0) {
      const cur = khungMap.get(candidateRows[left].makhung);
      const prev = khungMap.get(candidateRows[left - 1].makhung);
      if (!cur || !prev || prev.tietketthuc + 1 !== cur.tietbatdau) break;
      left -= 1;
    }
    while (right < candidateRows.length - 1) {
      const cur = khungMap.get(candidateRows[right].makhung);
      const next = khungMap.get(candidateRows[right + 1].makhung);
      if (!cur || !next || cur.tietketthuc + 1 !== next.tietbatdau) break;
      right += 1;
    }
    originalRows = candidateRows.slice(left, right + 1);
  }

  return {
    row,
    originalRows: originalRows.length ? originalRows : [row],
    pc: pcRes.data,
    mon: monMap.get(pcRes.data.mamon) || {},
    monMap,
    khungMap,
    roomMap,
  };
}

async function checkMakeupSlot({ matkbGoc, tuanhoc, ngayhoc, maphong, makhung, excludeMatkb = null }) {
  const ctx = await fetchScheduleContext(matkbGoc);
  const parsedWeek = Number(tuanhoc);
  const parsedMakhung = Number(makhung);
  if (!Number.isInteger(parsedWeek) || parsedWeek < 0) {
    return { available: false, message: 'Tuần học bù không hợp lệ.' };
  }
  if (!ngayhoc) return { available: false, message: 'Ngày học bù không được để trống.' };
  if (!maphong) return { available: false, message: 'Phòng học bù không được để trống.' };

  const bounds = normalizeWeekBounds(ctx.pc);
  if (parsedWeek < bounds.start || parsedWeek > bounds.end) {
    return {
      available: false,
      message: `Học phần này chỉ diễn ra từ tuần ${bounds.start} đến tuần ${bounds.end}.`,
    };
  }

  const newKhung = ctx.khungMap.get(parsedMakhung);
  if (!newKhung) return { available: false, message: 'Khung tiết học bù không tồn tại.' };
  const newDayIndex = deriveDateDayIndex(ngayhoc) ?? newKhung.day_index;
  if (newDayIndex !== newKhung.day_index) {
    return { available: false, message: 'Ngày học bù không khớp với thứ của khung tiết.' };
  }
  const room = ctx.roomMap.get(maphong);
  if (!room) return { available: false, message: 'Phòng học bù không tồn tại.' };

  const roomMsg = roomCompatibilityMessage(ctx.pc, ctx.mon, room, ctx.monMap);
  if (roomMsg) return { available: false, message: roomMsg };

  const duration = sessionDurationFromAssignment(ctx.pc, ctx.originalRows.length);
  const newStart = newKhung.tietbatdau;
  if (!allowedMakeupStartSlots(duration).includes(newStart)) {
    return {
      available: false,
      message: duration >= 5
        ? 'Môn 5 tiết/buổi chỉ được xếp vào khung 1-5 hoặc 7-11.'
        : 'Môn 3 tiết/buổi chỉ được xếp vào khung 1-3, 4-6, 7-9 hoặc 10-12.',
    };
  }
  const newEnd = newStart + duration - 1;
  if (newEnd > 12) {
    return { available: false, message: 'Khung học bù không đủ số tiết của buổi học gốc.' };
  }
  const { data: weekRows, error } = await supabase
    .from('thoi_khoa_bieu')
    .select('*')
    .eq('tuanhoc', parsedWeek);
  if (error) throw new Error(error.message);
  const rows = (weekRows || []).filter((r) => ['DANG_HOC', 'HOC_BU'].includes(normalizeScheduleStatus(r.trangthai)));

  const mapcSet = [...new Set((rows || []).map((r) => r.mapc).concat(ctx.pc.mapc))];
  const { data: pcs, error: pcError } = await supabase
    .from('phan_cong_giang_day')
    .select('*')
    .in('mapc', mapcSet.length ? mapcSet : ['__none__']);
  if (pcError) throw new Error(pcError.message);
  const pcMap = new Map((pcs || []).map((p) => [p.mapc, p]));

  const excludedMatkbs = new Set([].concat(excludeMatkb || []));
  for (const old of rows || []) {
    if (excludedMatkbs.has(old.matkb)) continue;
    const oldKhung = ctx.khungMap.get(old.makhung);
    const oldPc = pcMap.get(old.mapc);
    if (!oldKhung || !oldPc) continue;
    const oldDayIndex = old.ngayhoc ? deriveDateDayIndex(old.ngayhoc) : oldKhung.day_index;
    const sameDate = old.ngayhoc && ngayhoc ? String(old.ngayhoc).slice(0, 10) === String(ngayhoc).slice(0, 10) : false;
    const sameDay = sameDate || oldDayIndex === newDayIndex;
    if (!sameDay || !rangesOverlap(oldKhung.tietbatdau, oldKhung.tietketthuc, newStart, newEnd)) continue;

    if (sameCode(oldPc.magv, ctx.pc.magv)) return { available: false, message: 'Giảng viên đã có lịch dạy trong khung giờ này.' };
    if (sameCode(oldPc.malop, ctx.pc.malop)) return { available: false, message: 'Lớp đã có lịch học trong khung giờ này.' };
    if (sameCode(old.maphong, maphong)) return { available: false, message: 'Phòng đã được sử dụng trong khung giờ này.' };
  }

  return {
    available: true,
    message: 'Slot hợp lệ',
    context: ctx,
    newStart,
    newEnd,
    duration,
  };
}

async function buildAvailableMakeupSlots({ matkbGoc, tuanhoc, ngayhoc, excludeMatkb = null }) {
  const ctx = await fetchScheduleContext(matkbGoc);
  const parsedWeek = Number(tuanhoc);
  if (!Number.isInteger(parsedWeek) || parsedWeek < 0) {
    throw new Error('Tuần học bù không hợp lệ.');
  }
  if (!ngayhoc) throw new Error('Ngày học bù không được để trống.');

  const bounds = normalizeWeekBounds(ctx.pc);
  if (parsedWeek < bounds.start || parsedWeek > bounds.end) {
    throw new Error(`Học phần này chỉ diễn ra từ tuần ${bounds.start} đến tuần ${bounds.end}.`);
  }

  const dayIdx = deriveDateDayIndex(ngayhoc);
  if (dayIdx === null) throw new Error('Ngày học bù không hợp lệ.');
  const duration = sessionDurationFromAssignment(ctx.pc, ctx.originalRows.length);
  const allowedStarts = allowedMakeupStartSlots(duration);

  const dayKhungs = [...ctx.khungMap.values()]
    .filter((k) => k.day_index === dayIdx)
    .sort((a, b) => a.tietbatdau - b.tietbatdau);

  const { data: weekRows, error } = await supabase
    .from('thoi_khoa_bieu')
    .select('*')
    .eq('tuanhoc', parsedWeek);
  if (error) throw new Error(error.message);
  const rows = (weekRows || []).filter((r) => ['DANG_HOC', 'HOC_BU'].includes(normalizeScheduleStatus(r.trangthai)));
  const excludedMatkbs = new Set([].concat(excludeMatkb || []));
  const activeRows = rows.filter((r) => !excludedMatkbs.has(r.matkb));

  const mapcSet = [...new Set(activeRows.map((r) => r.mapc).concat(ctx.pc.mapc))];
  const { data: pcs, error: pcError } = await supabase
    .from('phan_cong_giang_day')
    .select('*')
    .in('mapc', mapcSet.length ? mapcSet : ['__none__']);
  if (pcError) throw new Error(pcError.message);
  const pcMap = new Map((pcs || []).map((p) => [p.mapc, p]));

  const compatibleRooms = [...ctx.roomMap.values()].filter((room) => (
    roomCompatibilityMessage(ctx.pc, ctx.mon, room, ctx.monMap) === null
  ));

  return dayKhungs
    .filter((startKhung) => allowedStarts.includes(startKhung.tietbatdau))
    .filter((startKhung) => startKhung.tietbatdau + duration - 1 <= 12)
    .map((startKhung) => {
      const newStart = startKhung.tietbatdau;
      const newEnd = newStart + duration - 1;
      let teacherBusy = false;
      let classBusy = false;
      const busyRooms = new Set();

      for (const old of activeRows) {
        const oldKhung = ctx.khungMap.get(old.makhung);
        const oldPc = pcMap.get(old.mapc);
        if (!oldKhung || !oldPc) continue;
        const oldDayIndex = old.ngayhoc ? deriveDateDayIndex(old.ngayhoc) : oldKhung.day_index;
        const sameDate = old.ngayhoc && ngayhoc ? String(old.ngayhoc).slice(0, 10) === String(ngayhoc).slice(0, 10) : false;
        const sameDay = sameDate || oldDayIndex === dayIdx;
        if (!sameDay || !rangesOverlap(oldKhung.tietbatdau, oldKhung.tietketthuc, newStart, newEnd)) continue;

        if (sameCode(oldPc.magv, ctx.pc.magv)) teacherBusy = true;
        if (sameCode(oldPc.malop, ctx.pc.malop)) classBusy = true;
        busyRooms.add(String(old.maphong || '').trim().toUpperCase());
      }

      const availableRooms = compatibleRooms
        .filter((room) => !busyRooms.has(String(room.maphong || '').trim().toUpperCase()))
        .map((room) => ({
          maphong: room.maphong,
          tenphong: room.tenphong,
          loaiphong: normalizeRoomType(room.loaiphong),
        }));
      const teacher = {
        available: !teacherBusy,
        message: teacherBusy ? 'GV bận' : 'GV rảnh',
      };
      const klass = {
        available: !classBusy,
        message: classBusy ? 'Lớp đang học' : 'Lớp rảnh',
      };
      const rooms = {
        available_rooms: availableRooms,
        message: availableRooms.length ? availableRooms.map((r) => r.maphong).join(', ') : 'Không có phòng',
      };
      const selectable = teacher.available && klass.available && availableRooms.length > 0;
      const reason = selectable
        ? 'Chọn được'
        : [teacher.message, klass.message, rooms.message].filter((m) => !['GV rảnh', 'Lớp rảnh'].includes(m) && m !== '').join('; ');

      return {
        makhung: startKhung.makhung,
        label: `Tiết ${newStart}-${newEnd}`,
        tietbatdau: newStart,
        tietketthuc: newEnd,
        teacher,
        class: klass,
        rooms,
        selectable,
        reason: reason || 'Không được',
      };
    });
}

async function writeScheduleHistory({ matkbGoc, matkbMoi, hanhdong, lydo, nguoithuchien }) {
  const { error } = await supabase.from('lich_su_doi_lich').insert({
    matkb_goc: matkbGoc,
    matkb_moi: matkbMoi,
    hanhdong,
    lydo: lydo || null,
    nguoithuchien: nguoithuchien || 'admin',
  });
  if (error) throw new Error(error.message);
}

async function deleteAssignmentsAndSchedules(filters) {
  let query = supabase.from('phan_cong_giang_day').select('mapc');
  for (const [column, value] of Object.entries(filters)) {
    query = query.eq(column, value);
  }

  const { data: assignments, error: selectError } = await query;
  if (selectError) throw new Error(selectError.message);

  const mapcList = (assignments || []).map((row) => row.mapc).filter(Boolean);
  if (mapcList.length > 0) {
    const { error: scheduleError } = await supabase
      .from('thoi_khoa_bieu')
      .delete()
      .in('mapc', mapcList);
    if (scheduleError) throw new Error(scheduleError.message);

    const { error: assignmentError } = await supabase
      .from('phan_cong_giang_day')
      .delete()
      .in('mapc', mapcList);
    if (assignmentError) throw new Error(assignmentError.message);
  }
}

app.get('/api/giangvien', async (req, res) => {
  const { data, error } = await supabase
    .from('giang_vien')
    .select('*');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/giangvien', async (req, res) => {
  try {
    const body = req.body || {};
    const tengv = optionalText(firstValue(body, ['TenGV', 'tengv']));
    const email = optionalText(firstValue(body, ['Email', 'email']));
    if (!tengv || !email) throw new Error('Vui long nhap ho ten va email');

    const row = {
      magv: optionalText(firstValue(body, ['MaGV', 'magv'])) || await generateNextCode('giang_vien', 'magv', 'GV', 3),
      tengv,
      email,
      sdt: optionalText(firstValue(body, ['SDT', 'sdt'])),
      hocvi: optionalText(firstValue(body, ['HocVi', 'hocvi'])),
      chuyenmon: optionalText(firstValue(body, ['ChuyenMon', 'chuyenmon'])),
      trangthai: optionalText(firstValue(body, ['TrangThai', 'trangthai'])),
    };

    const { data, error } = await supabase.from('giang_vien').insert(row).select('*').single();
    if (error) return sendSupabaseError(res, error);
    return res.status(201).json(data);
  } catch (error) {
    return sendSupabaseError(res, error);
  }
});

app.put('/api/giangvien/:magv', async (req, res) => {
  try {
    const body = req.body || {};
    const row = {
      tengv: optionalText(firstValue(body, ['TenGV', 'tengv'])),
      email: optionalText(firstValue(body, ['Email', 'email'])),
      sdt: optionalText(firstValue(body, ['SDT', 'sdt'])),
      hocvi: optionalText(firstValue(body, ['HocVi', 'hocvi'])),
      chuyenmon: optionalText(firstValue(body, ['ChuyenMon', 'chuyenmon'])),
      trangthai: optionalText(firstValue(body, ['TrangThai', 'trangthai'])),
    };

    const { data, error } = await supabase
      .from('giang_vien')
      .update(row)
      .eq('magv', req.params.magv)
      .select('*')
      .single();
    if (error) return sendSupabaseError(res, error);
    return res.json(data);
  } catch (error) {
    return sendSupabaseError(res, error);
  }
});

app.delete('/api/giangvien/:magv', async (req, res) => {
  try {
    await deleteAssignmentsAndSchedules({ magv: req.params.magv });
    const { error } = await supabase.from('giang_vien').delete().eq('magv', req.params.magv);
    if (error) return sendSupabaseError(res, error);
    return res.json({ ok: true });
  } catch (error) {
    return sendSupabaseError(res, error);
  }
});

app.get('/api/lop', async (req, res) => {
  const { data, error } = await supabase
    .from('lop')
    .select('malop, tenlop, khoa');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/lop', async (req, res) => {
  try {
    const body = req.body || {};
    const tenlop = optionalText(firstValue(body, ['TenLop', 'tenlop']));
    const khoa = optionalText(firstValue(body, ['Khoa', 'MaKhoa', 'khoa']));
    if (!tenlop || !khoa) throw new Error('Vui long nhap ten lop va khoa');

    const row = {
      malop: optionalText(firstValue(body, ['MaLop', 'malop'])) || await generateNextCode('lop', 'malop', 'L', 2),
      tenlop,
      khoa,
    };

    const { data, error } = await supabase.from('lop').insert(row).select('*').single();
    if (error) return sendSupabaseError(res, error);
    return res.status(201).json(data);
  } catch (error) {
    return sendSupabaseError(res, error);
  }
});

app.put('/api/lop/:malop', async (req, res) => {
  try {
    const body = req.body || {};
    const row = {
      tenlop: optionalText(firstValue(body, ['TenLop', 'tenlop'])),
      khoa: optionalText(firstValue(body, ['Khoa', 'MaKhoa', 'khoa'])),
    };

    const { data, error } = await supabase
      .from('lop')
      .update(row)
      .eq('malop', req.params.malop)
      .select('*')
      .single();
    if (error) return sendSupabaseError(res, error);
    return res.json(data);
  } catch (error) {
    return sendSupabaseError(res, error);
  }
});

app.delete('/api/lop/:malop', async (req, res) => {
  try {
    await deleteAssignmentsAndSchedules({ malop: req.params.malop });
    const { error } = await supabase.from('lop').delete().eq('malop', req.params.malop);
    if (error) return sendSupabaseError(res, error);
    return res.json({ ok: true });
  } catch (error) {
    return sendSupabaseError(res, error);
  }
});

app.get('/api/hocky', async (req, res) => {
  const { data, error } = await supabase
    .from('hoc_ky')
    .select('mahk, tenhocky, namhoc, trangthai')
    .order('mahk', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.get('/api/monhoc', async (req, res) => {
  const { data, error } = await supabase
    .from('mon_hoc')
    .select('mamon, tenmon, sotinchi, tongsotiet, sotietlythuyet, sotietthuchanh, loaiphong');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/monhoc', async (req, res) => {
  try {
    const body = req.body || {};
    const tenmon = optionalText(firstValue(body, ['TenMon', 'tenmon']));
    if (!tenmon) throw new Error('Vui long nhap ten mon hoc');

    const row = {
      mamon: optionalText(firstValue(body, ['MaMon', 'mamon'])) || await generateNextCode('mon_hoc', 'mamon', 'MH', 3),
      tenmon,
      sotinchi: parseBodyNumber(firstValue(body, ['SoTinChi', 'sotinchi']), 'sotinchi'),
      tongsotiet: parseBodyNumber(firstValue(body, ['TongSoTiet', 'tongsotiet']), 'tongsotiet'),
      sotietlythuyet: parseBodyNumber(firstValue(body, ['SoTietLT', 'sotietlythuyet']), 'sotietlythuyet'),
      sotietthuchanh: parseBodyNumber(firstValue(body, ['SoTietTH', 'sotietthuchanh']), 'sotietthuchanh'),
      loaiphong: optionalText(firstValue(body, ['LoaiPhong', 'loaiphong'])),
    };

    const { data, error } = await supabase.from('mon_hoc').insert(row).select('*').single();
    if (error) return sendSupabaseError(res, error);
    return res.status(201).json(data);
  } catch (error) {
    return sendSupabaseError(res, error);
  }
});

app.put('/api/monhoc/:mamon', async (req, res) => {
  try {
    const body = req.body || {};
    const row = {
      tenmon: optionalText(firstValue(body, ['TenMon', 'tenmon'])),
      sotinchi: parseBodyNumber(firstValue(body, ['SoTinChi', 'sotinchi']), 'sotinchi'),
      tongsotiet: parseBodyNumber(firstValue(body, ['TongSoTiet', 'tongsotiet']), 'tongsotiet'),
      sotietlythuyet: parseBodyNumber(firstValue(body, ['SoTietLT', 'sotietlythuyet']), 'sotietlythuyet'),
      sotietthuchanh: parseBodyNumber(firstValue(body, ['SoTietTH', 'sotietthuchanh']), 'sotietthuchanh'),
      loaiphong: optionalText(firstValue(body, ['LoaiPhong', 'loaiphong'])),
    };

    const { data, error } = await supabase
      .from('mon_hoc')
      .update(row)
      .eq('mamon', req.params.mamon)
      .select('*')
      .single();
    if (error) return sendSupabaseError(res, error);
    return res.json(data);
  } catch (error) {
    return sendSupabaseError(res, error);
  }
});

app.delete('/api/monhoc/:mamon', async (req, res) => {
  try {
    await deleteAssignmentsAndSchedules({ mamon: req.params.mamon });
    const { error } = await supabase.from('mon_hoc').delete().eq('mamon', req.params.mamon);
    if (error) return sendSupabaseError(res, error);
    return res.json({ ok: true });
  } catch (error) {
    return sendSupabaseError(res, error);
  }
});

app.get('/api/phonghoc', async (req, res) => {
  const { data, error } = await supabase
    .from('phong_hoc')
    .select('maphong, tenphong, loaiphong, trangthai');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/phonghoc', async (req, res) => {
  try {
    const body = req.body || {};
    const tenphong = optionalText(firstValue(body, ['TenPhong', 'tenphong']));
    if (!tenphong) throw new Error('Vui long nhap ten phong');

    const row = {
      maphong: optionalText(firstValue(body, ['MaPhong', 'maphong'])) || await generateNextCode('phong_hoc', 'maphong', 'P', 3),
      tenphong,
      loaiphong: optionalText(firstValue(body, ['LoaiPhong', 'loaiphong'])),
      trangthai: optionalText(firstValue(body, ['TrangThai', 'trangthai'])),
    };

    const { data, error } = await supabase.from('phong_hoc').insert(row).select('*').single();
    if (error) return sendSupabaseError(res, error);
    return res.status(201).json(data);
  } catch (error) {
    return sendSupabaseError(res, error);
  }
});

app.put('/api/phonghoc/:maphong', async (req, res) => {
  try {
    const body = req.body || {};
    const row = {
      tenphong: optionalText(firstValue(body, ['TenPhong', 'tenphong'])),
      loaiphong: optionalText(firstValue(body, ['LoaiPhong', 'loaiphong'])),
      trangthai: optionalText(firstValue(body, ['TrangThai', 'trangthai'])),
    };

    const { data, error } = await supabase
      .from('phong_hoc')
      .update(row)
      .eq('maphong', req.params.maphong)
      .select('*')
      .single();
    if (error) return sendSupabaseError(res, error);
    return res.json(data);
  } catch (error) {
    return sendSupabaseError(res, error);
  }
});

app.delete('/api/phonghoc/:maphong', async (req, res) => {
  try {
    const { error: scheduleError } = await supabase
      .from('thoi_khoa_bieu')
      .delete()
      .eq('maphong', req.params.maphong);
    if (scheduleError) throw new Error(scheduleError.message);

    const { error } = await supabase.from('phong_hoc').delete().eq('maphong', req.params.maphong);
    if (error) return sendSupabaseError(res, error);
    return res.json({ ok: true });
  } catch (error) {
    return sendSupabaseError(res, error);
  }
});

app.get('/api/phan-cong', async (req, res) => {
  try {
    let query = supabase.from('phan_cong_giang_day').select('*');
    if (req.query.malop)  query = query.eq('malop',  String(req.query.malop));
    if (req.query.mamon)  query = query.eq('mamon',  String(req.query.mamon));
    if (req.query.mahk)   query = query.eq('mahk',   Number(req.query.mahk));
    if (req.query.namhoc) query = query.eq('namhoc', String(req.query.namhoc));
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/tkb/check-slot', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await checkMakeupSlot({
      matkbGoc: body.matkb_goc,
      tuanhoc: body.tuanhoc,
      ngayhoc: body.ngayhoc,
      maphong: body.maphong,
      makhung: body.makhung,
      excludeMatkb: body.exclude_matkb || null,
    });
    return res.status(result.available ? 200 : 400).json({
      available: result.available,
      message: result.message,
    });
  } catch (error) {
    return res.status(400).json({ available: false, message: error.message });
  }
});

app.post('/api/tkb/:matkb/available-makeup-slots', async (req, res) => {
  try {
    const body = req.body || {};
    const slots = await buildAvailableMakeupSlots({
      matkbGoc: req.params.matkb,
      tuanhoc: body.tuanhoc,
      ngayhoc: body.ngayhoc,
      excludeMatkb: body.exclude_matkb || null,
    });
    return res.json({
      ok: true,
      slots,
    });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message, slots: [] });
  }
});

app.post('/api/tkb/:matkb/tam-ngung', async (req, res) => {
  try {
    const matkb = req.params.matkb;
    const body = req.body || {};
    const ctx = await fetchScheduleContext(matkb);
    const status = normalizeScheduleStatus(ctx.row.trangthai);
    if (status === 'HOC_BU') {
      return res.status(400).json({ success: false, message: 'Không thể tạm ngưng trực tiếp một buổi học bù.' });
    }
    if (status === 'TAM_NGUNG') {
      return res.status(400).json({ success: false, message: 'Buổi học này đã tạm ngưng.' });
    }

    const originalIds = ctx.originalRows.map((r) => r.matkb);
    const { data: updated, error: updateError } = await supabase
      .from('thoi_khoa_bieu')
      .update({
        trangthai: 'TAM_NGUNG',
        lydo: body.lydo || null,
        ngaycapnhat: new Date().toISOString(),
      })
      .in('matkb', originalIds)
      .select('*');
    if (updateError) throw new Error(updateError.message);

    await writeScheduleHistory({
      matkbGoc: matkb,
      matkbMoi: null,
      hanhdong: 'TAM_NGUNG',
      lydo: body.lydo,
      nguoithuchien: body.nguoithuchien,
    });

    return res.json({
      success: true,
      message: 'Đã tạm ngưng buổi học',
      original: updated,
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

app.post('/api/tkb/:matkb/tao-hoc-bu', async (req, res) => {
  try {
    const matkb = req.params.matkb;
    const body = req.body || {};
    const ctx = await fetchScheduleContext(matkb);
    const status = normalizeScheduleStatus(ctx.row.trangthai);
    if (status === 'HOC_BU') {
      return res.status(400).json({ success: false, message: 'Không thể tạo học bù từ một buổi học bù.' });
    }

    const { data: existingMakeups, error: existingError } = await supabase
      .from('thoi_khoa_bieu')
      .select('matkb')
      .eq('tkb_goc_id', matkb)
      .eq('trangthai', 'HOC_BU');
    if (existingError) throw new Error(existingError.message);
    if ((existingMakeups || []).length > 0) {
      return res.status(400).json({ success: false, message: 'Buổi học này đã có lịch học bù.' });
    }

    const check = await checkMakeupSlot({
      matkbGoc: matkb,
      tuanhoc: body.tuanhoc,
      ngayhoc: body.ngayhoc,
      maphong: body.maphong,
      makhung: body.makhung,
    });
    if (!check.available) {
      return res.status(400).json({ success: false, message: check.message });
    }

    const parsedWeek = Number(body.tuanhoc);
    const parsedMakhung = Number(body.makhung);
    const newKhung = ctx.khungMap.get(parsedMakhung);
    const byDaySlot = new Map(
      [...ctx.khungMap.values()]
        .filter((k) => k.day_index === newKhung.day_index)
        .map((k) => [k.tietbatdau, k])
    );
    const duration = check.duration;
    const makeupRows = [];
    for (let offset = 0; offset < duration; offset += 1) {
      const k = byDaySlot.get(newKhung.tietbatdau + offset);
      if (!k) throw new Error('Không tìm thấy đủ khung tiết để tạo học bù.');
      makeupRows.push({
        matkb: crypto.randomUUID(),
        mapc: ctx.row.mapc,
        mahk: ctx.row.mahk ?? ctx.pc.mahk ?? null,
        tuanhoc: parsedWeek,
        ngayhoc: body.ngayhoc,
        maphong: body.maphong,
        makhung: k.makhung,
        trangthai: 'HOC_BU',
        tkb_goc_id: matkb,
        lydo: body.lydo || null,
        ngaycapnhat: new Date().toISOString(),
      });
    }

    const originalIds = ctx.originalRows.map((r) => r.matkb);
    const { data: updatedOriginal, error: updateError } = await supabase
      .from('thoi_khoa_bieu')
      .update({
        trangthai: 'TAM_NGUNG',
        lydo: body.lydo || null,
        ngaycapnhat: new Date().toISOString(),
      })
      .in('matkb', originalIds)
      .select('*');
    if (updateError) throw new Error(updateError.message);

    const { data: insertedMakeup, error: insertError } = await supabase
      .from('thoi_khoa_bieu')
      .insert(makeupRows)
      .select('*');
    if (insertError) throw new Error(insertError.message);

    await writeScheduleHistory({
      matkbGoc: matkb,
      matkbMoi: makeupRows[0].matkb,
      hanhdong: 'TAO_HOC_BU',
      lydo: body.lydo,
      nguoithuchien: body.nguoithuchien,
    });

    return res.json({
      success: true,
      message: 'Tạo lịch học bù thành công',
      original: updatedOriginal,
      makeup: insertedMakeup,
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

app.put('/api/tkb/:matkb_hocbu', async (req, res) => {
  try {
    const matkbHocBu = req.params.matkb_hocbu;
    const body = req.body || {};
    const { data: row, error: rowError } = await supabase
      .from('thoi_khoa_bieu')
      .select('*')
      .eq('matkb', matkbHocBu)
      .maybeSingle();
    if (rowError) throw new Error(rowError.message);
    if (!row) return res.status(404).json({ success: false, message: 'Không tìm thấy lịch học bù.' });
    if (normalizeScheduleStatus(row.trangthai) !== 'HOC_BU') {
      return res.status(400).json({ success: false, message: 'Chỉ được chỉnh sửa lịch có trạng thái HOC_BU.' });
    }
    if (!row.tkb_goc_id) {
      return res.status(400).json({ success: false, message: 'Lịch học bù thiếu liên kết buổi gốc.' });
    }

    const { data: sameMakeupRows, error: sameError } = await supabase
      .from('thoi_khoa_bieu')
      .select('*')
      .eq('tkb_goc_id', row.tkb_goc_id)
      .eq('trangthai', 'HOC_BU');
    if (sameError) throw new Error(sameError.message);
    const excludeIds = (sameMakeupRows || []).map((r) => r.matkb);

    const check = await checkMakeupSlot({
      matkbGoc: row.tkb_goc_id,
      tuanhoc: body.tuanhoc,
      ngayhoc: body.ngayhoc,
      maphong: body.maphong,
      makhung: body.makhung,
      excludeMatkb: excludeIds,
    });
    if (!check.available) {
      return res.status(400).json({ success: false, message: check.message });
    }

    const ctx = check.context;
    const parsedMakhung = Number(body.makhung);
    const newKhung = ctx.khungMap.get(parsedMakhung);
    const byDaySlot = new Map(
      [...ctx.khungMap.values()]
        .filter((k) => k.day_index === newKhung.day_index)
        .map((k) => [k.tietbatdau, k])
    );
    const duration = check.duration;
    const sortedRows = (sameMakeupRows || []).sort((a, b) => {
      const ak = ctx.khungMap.get(a.makhung);
      const bk = ctx.khungMap.get(b.makhung);
      return (ak?.tietbatdau || 0) - (bk?.tietbatdau || 0);
    });

    const updatedRows = [];
    for (let i = 0; i < sortedRows.length; i += 1) {
      const k = byDaySlot.get(newKhung.tietbatdau + i);
      if (!k) throw new Error('Không tìm thấy đủ khung tiết để chỉnh học bù.');
      const { data: updated, error: updateError } = await supabase
        .from('thoi_khoa_bieu')
        .update({
          tuanhoc: Number(body.tuanhoc),
          ngayhoc: body.ngayhoc,
          maphong: body.maphong,
          makhung: k.makhung,
          lydo: body.lydo || null,
          ngaycapnhat: new Date().toISOString(),
        })
        .eq('matkb', sortedRows[i].matkb)
        .select('*')
        .single();
      if (updateError) throw new Error(updateError.message);
      updatedRows.push(updated);
    }

    await writeScheduleHistory({
      matkbGoc: row.tkb_goc_id,
      matkbMoi: matkbHocBu,
      hanhdong: 'CHINH_SUA_HOC_BU',
      lydo: body.lydo,
      nguoithuchien: body.nguoithuchien,
    });

    return res.json({
      success: true,
      message: 'Chỉnh lịch học bù thành công',
      makeup: updatedRows,
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

app.get('/api/tkb', async (req, res) => {
  try {
    const tuanhoc = parseOptionalNumber(req.query.tuanhoc, 'tuanhoc');
    const mahk   = parseOptionalNumber(req.query.mahk, 'mahk');
    const namhoc = req.query.namhoc ? String(req.query.namhoc) : null;
    const mapc = req.query.mapc ? String(req.query.mapc) : null;

    let filterMapc = null;
    if (mahk !== null || namhoc) {
      let pcQuery = supabase.from('phan_cong_giang_day').select('mapc');
      if (mahk !== null) {
        pcQuery = pcQuery.eq('mahk', mahk);
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
    const mahk  = parseOptionalNumber(req.query.mahk, 'mahk');
    const namhoc = req.query.namhoc ? String(req.query.namhoc) : null;

    const { rawData } = await getSupabaseGaInput({ mahk, namhoc });
    return res.json({
      ok: true,
      filters: { mahk, namhoc },
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
      mahk   = null,   // mã học kỳ từ bảng hoc_ky
      namhoc = null,
      tuanhoc = 1,
      persist = true,
      popSize = 20,
      maxGen = 500,
    } = req.body || {};
    const parsedMahk = mahk !== null ? Number(mahk) : null;

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

    // Auto-seed nếu bảng phan_cong rỗng (user xóa khi test)
    {
      const { count } = await supabase
        .from('phan_cong_giang_day').select('*', { count: 'exact', head: true });
      if (!count || count === 0) {
        console.log('[GA] phan_cong_giang_day trong, dang tu dong seed lai...');
        const seedResult = spawnSync(
          'node',
          [path.join(__dirname, 'scripts/bootstrap_assignments.js')],
          { stdio: 'pipe', encoding: 'utf8', cwd: __dirname }  // cwd rõ ràng tránh path lỗi
        );
        const seedErr = (seedResult.stderr || '').trim() || (seedResult.stdout || '').trim();
        if (seedResult.status !== 0) {
          console.error('[GA] Auto-seed that bai:\n', seedErr);
          return res.status(500).json({
            ok: false,
            error: `Auto-seed that bai: ${seedErr || 'exit code ' + seedResult.status}`,
          });
        }
        console.log('[GA] Auto-seed thanh cong:\n', seedResult.stdout);
      }
    }

    const { rawData, khungThoiGian } = await getSupabaseGaInput({ mahk: parsedMahk, namhoc });

    // ── Lọc theo malop/mamon (hỗ trợ cả string lẫn array) ───────────────
    const malops = [].concat(req.body.malop || []).map(String).filter(Boolean);
    const mamons = [].concat(req.body.mamon || []).map(String).filter(Boolean);
    if (malops.length > 0) {
      rawData.phan_cong_giang_day = (rawData.phan_cong_giang_day || []).filter(
        (pc) => malops.includes(pc.malop)
      );
    }
    if (mamons.length > 0) {
      // Normalize mamon: strip "_LT"/"_TH" suffix khi so sánh
      // VD: user chọn "IT01_LT" từ mon_hoc → vẫn match phan_cong.mamon="IT01"
      const stripSuffix = (m) => String(m).replace(/_(LT|TH)$/i, '');
      const mamonBases  = new Set(mamons.map(stripSuffix));
      rawData.phan_cong_giang_day = (rawData.phan_cong_giang_day || []).filter(
        (pc) => mamons.includes(pc.mamon) || mamonBases.has(stripSuffix(pc.mamon))
      );
    }

    // ── Enforce session rules + loại bỏ phân công đã hoàn thành ──────────
    const monMap = new Map((rawData.mon_hoc || []).map((m) => [m.mamon, m]));

    // Build thToLtMamon: mamon_TH → mamon_LT, dựa trên tenmon.
    // TH tenmon = LT tenmon + "-Thực hành" (quy tắc đặt tên trong DB này).
    // Đây là cách link duy nhất đúng vì mamon là dãy số, không có suffix _LT/_TH.
    const tenmonToLtMamon = new Map();
    for (const mon of rawData.mon_hoc || []) {
      const isLT = Number(mon.sotietlythuyet || 0) > 0
                && Number(mon.sotietthuchanh || 0) === 0;
      if (isLT) tenmonToLtMamon.set(subjectBaseKey(mon.tenmon), mon.mamon);
    }
    // Suffix TH trong tenmon: "-Thực hành" hoặc "-Thực Hành" (cả 2 cách viết)
    const TH_SUFFIXES = ['-Thực hành', '-Thực Hành', '-thực hành', '-THỰC HÀNH'];
    const thToLtMamon = new Map(); // mamon_TH → mamon_LT
    for (const mon of rawData.mon_hoc || []) {
      const isTH = Number(mon.sotietthuchanh || 0) > 0
                && Number(mon.sotietlythuyet  || 0) === 0;
      if (!isTH) continue;
      const ltMamon = tenmonToLtMamon.get(subjectBaseKey(mon.tenmon));
      if (ltMamon) {
        thToLtMamon.set(mon.mamon, ltMamon);
        console.log(`[GA] Link TH->LT: ${mon.mamon} -> ${ltMamon}`);
      }
    }
    const ltMamonsWithTH = new Set(thToLtMamon.values()); // LT mamon nào có TH kèm theo

    // Môn đặc biệt cần 5 tiết/buổi (LT-only, không có TH) — cấu hình qua SPECIAL_5TIET_MAMONS
    // VD trong .env.local: SPECIAL_5TIET_MAMONS=TTNT,AI,...
    const special5TietMamons = new Set(
      (process.env.SPECIAL_5TIET_MAMONS || '')
        .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
    );
    if (special5TietMamons.size > 0) {
      console.log(`[GA] Mon dac biet 5 tiet/buoi (LT-only): ${[...special5TietMamons].join(', ')}`);
    }

    console.log(`[GA] === DEBUG DATA ===`);
    console.log(`[GA] mon_hoc keys: ${[...monMap.keys()].join(', ')}`);
    (rawData.phan_cong_giang_day || []).forEach((p) => {
      console.log(`[GA] pc: mamon=${p.mamon} loaiphong=${p.loaiphong} sotiet=${p.sotietmoibuoi} sobuoi=${p.sobuoimoituan}`);
    });

    // Bước 1: enforce session rules
    //   sotietmoibuoi=5 → sobuoimoituan=1
    //   Môn trong SPECIAL_5TIET_MAMONS → bắt buộc 5 tiết dù DB đang là 3
    rawData.phan_cong_giang_day = (rawData.phan_cong_giang_day || []).map((pc) => {
      const isSpecial = special5TietMamons.has(String(pc.mamon).toUpperCase());
      const sotietmoibuoi = isSpecial ? 5 : (Number(pc.sotietmoibuoi) || 3);
      const sobuoimoituan = sotietmoibuoi === 5
        ? 1
        : Math.min(2, Math.max(1, Number(pc.sobuoimoituan) || 1));
      if (isSpecial) console.log(`[GA] Override 5 tiet cho mon dac biet: ${pc.mamon}`);
      return { ...pc, sobuoimoituan, sotietmoibuoi };
    });

    // Bước 1b: LT của môn có học phần TH → bắt buộc sotietmoibuoi=5, sobuoimoituan=1.
    // Link LT↔TH qua thToLtMamon (tenmon-based), KHÔNG dùng mamon suffix vì mamon là số.
    rawData.phan_cong_giang_day = (rawData.phan_cong_giang_day || []).map((pc) => {
      if (normalizeRoomType(pc.loaiphong) !== 'LT') return pc;
      if (ltMamonsWithTH.has(pc.mamon)) {
        console.log(`[GA] Enforce 5t/buoi cho LT co TH: ${pc.mamon}`);
        return { ...pc, sotietmoibuoi: 5, sobuoimoituan: 1 };
      }
      return pc;
    });

    // Bước 2a: build ltWeeksMap keyed by (lt_mamon, malop).
    // Dùng sotietlythuyet làm fallback nếu tongsotiet = 0.
    const ltWeeksMap = new Map();
    for (const pc of rawData.phan_cong_giang_day || []) {
      if (normalizeRoomType(pc.loaiphong) !== 'LT') continue;
      const mon = monMap.get(pc.mamon);
      const tong = Number(mon?.tongsotiet || 0) || Number(mon?.sotietlythuyet || 0);
      if (tong <= 0) continue;
      const tpw = pc.sobuoimoituan * pc.sotietmoibuoi;
      if (tpw <= 0) continue;
      const ltWeeks = Math.ceil(tong / tpw);
      ltWeeksMap.set(`${pc.mamon}|${pc.malop}`, ltWeeks);
      console.log(`[GA] ltWeeksMap: ${pc.mamon}|${pc.malop} = ${ltWeeks} tuan (tong=${tong}, tpw=${tpw})`);
    }

    // Bước 2b: lọc theo week-based stopping point (với offset cho TH)
    const before = (rawData.phan_cong_giang_day || []).length;
    rawData.phan_cong_giang_day = (rawData.phan_cong_giang_day || []).filter((pc) => {
      const mon = monMap.get(pc.mamon);
      const isLT = normalizeRoomType(pc.loaiphong) === 'LT';
      const isTH = normalizeRoomType(pc.loaiphong) === 'TH';
      // Fallback tongsotiet theo loại phòng nếu tongsotiet chưa được điền
      const tongsotiet = Number(mon?.tongsotiet || 0)
                      || (isLT ? Number(mon?.sotietlythuyet || 0) : 0)
                      || (isTH ? Number(mon?.sotietthuchanh || 0) : 0);
      if (tongsotiet <= 0) return true; // không giới hạn → luôn xếp

      const tietsPerWeek = pc.sobuoimoituan * pc.sotietmoibuoi;
      if (tietsPerWeek <= 0) return true;

      const soTuanCanHoc = Math.ceil(tongsotiet / tietsPerWeek);

      if (isTH) {
        // TH bắt đầu sau khi LT hoàn thành → offset week range.
        // Tìm lt_mamon qua thToLtMamon (link bằng tenmon, không phải mamon suffix).
        const ltMamon = thToLtMamon.get(pc.mamon);
        const ltWeeks = ltMamon ? (ltWeeksMap.get(`${ltMamon}|${pc.malop}`) || 0) : 0;
        const effectiveTuan = parsedTuanhoc - ltWeeks;
        console.log(`[GA] TH check: ${pc.mamon}→LT:${ltMamon}|${pc.malop} tuanhoc=${parsedTuanhoc} ltWeeks=${ltWeeks} eff=${effectiveTuan} soTuan=${soTuanCanHoc}`);
        return effectiveTuan <= soTuanCanHoc;
      }

      return parsedTuanhoc <= soTuanCanHoc;
    });
    const exhausted = before - (rawData.phan_cong_giang_day || []).length;
    if (exhausted > 0) {
      console.log(`[GA] Loai bo ${exhausted} phan cong da het so_tuan_can_hoc.`);
    }

    if ((rawData.phan_cong_giang_day || []).length === 0) {
      const hint = malops.length > 0
        ? `Khong co phan_cong nao cho lop [${malops.join(', ')}].`
        : mamons.length > 0
          ? `Khong co phan_cong nao cho mon [${mamons.join(', ')}].`
          : 'Bang phan_cong_giang_day trong hoac toan bo da het so_tuan_can_hoc.';
      return res.status(400).json({
        ok: false,
        error: `${hint} Hay bam "Reset du lieu" de seed lai du lieu.`,
        filters: { mahk: parsedMahk, namhoc, malop: malops, mamon: mamons },
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
      file_name: `supabase_hk${parsedMahk ?? 'all'}_nh${namhoc ?? 'all'}.json`,
      tuanhoc: parsedTuanhoc, // Python dùng để double-check so_tuan_can_hoc
    });

    const sessions = gaResult.sessions || [];
    const summary = gaResult.summary || {};
    const history = gaResult.history || [];
    const breakdown = gaResult.breakdown || {};
    const khungMap = buildKhungMap(khungThoiGian);

    // ── Tính số tuần cần học cho từng mapc ───────────────────────────────
    // GA tạo pattern 1 tuần → nhân ra TẤT CẢ tuần cần thiết theo tongsotiet.
    // Ví dụ: môn 45t, 2 buổi/tuần × 3t/buổi → 8 tuần → lưu tuanhoc 1..8 cùng lúc.
    const pcWeeksMap = new Map(); // mapc → so_tuan_can_hoc
    for (const pc of rawData.phan_cong_giang_day || []) {
      const mon = monMap.get(pc.mamon);
      // Ưu tiên tongsotiet từ pc (nếu có denormalized), rồi mới tra monMap
      const loai = normalizeRoomType(pc.loaiphong);
      const tongsotiet    = Number(pc.tongsotiet || mon?.tongsotiet || 0)
                          || (loai === 'TH'
                            ? Number(mon?.sotietthuchanh || 0)
                            : Number(mon?.sotietlythuyet || 0));
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

    // ── Tính tuần kết thúc LT cho từng base mamon (để TH bắt đầu sau) ──────
    const stripSfx   = (m) => String(m).replace(/_(LT|TH)$/i, '');
    const pcsByMapc  = new Map((rawData.phan_cong_giang_day || []).map(pc => [pc.mapc, pc]));
    const mapcMamon  = new Map((rawData.phan_cong_giang_day || []).map(pc => [pc.mapc, pc.mamon]));
    const ltEndWeek  = new Map(); // baseMamon → tuần cuối LT
    for (const [mapc, soTuan] of pcWeeksMap) {
      const pc = pcsByMapc.get(mapc);
      if (!pc || normalizeRoomType(pc.loaiphong) !== 'LT') continue;
      const mamon = mapcMamon.get(mapc) || '';
      if (String(mamon).toUpperCase().endsWith('_LT')) {
        const base = stripSfx(mamon);
        const endW = parsedTuanhoc + soTuan - 1;
        ltEndWeek.set(base, Math.max(ltEndWeek.get(base) || 0, endW));
      }
      const base = stripSfx(mamon);
      const endW = parsedTuanhoc + soTuan - 1;
      ltEndWeek.set(mamon, Math.max(ltEndWeek.get(mamon) || 0, endW));
      ltEndWeek.set(base, Math.max(ltEndWeek.get(base) || 0, endW));
    }

    // ── Nhân pattern ra tất cả tuần — TH bắt đầu sau khi LT xong ───────────
    const allRows = [];
    for (const row of baseRows) {
      const pc      = pcsByMapc.get(row.mapc);
      const mamon   = pc?.mamon || mapcMamon.get(row.mapc) || '';
      const isTH    = pc ? normalizeRoomType(pc.loaiphong) === 'TH' : String(mamon).toUpperCase().endsWith('_TH');
      const soTuan  = pcWeeksMap.get(row.mapc) || 1;

      // TH bắt đầu tuần ngay sau khi LT kết thúc
      let startWeek = parsedTuanhoc;
      if (isTH) {
        const ltMamon = thToLtMamon.get(mamon);
        const base    = stripSfx(mamon);
        const ltEnd   = (ltMamon ? ltEndWeek.get(ltMamon) : 0) || ltEndWeek.get(base) || 0;
        if (ltEnd > 0) startWeek = ltEnd + 1;
      }

      for (let w = startWeek; w < startWeek + soTuan; w++) {
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
      history,
      breakdown,
      filters: { mahk: parsedMahk, namhoc, tuanhoc: parsedTuanhoc, popSize: parsedPopSize, maxGen: parsedMaxGen },
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
    const mahk    = parseOptionalNumber(req.query.mahk, 'mahk');
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

    // Build pc map (soft filter theo mahk/namhoc)
    let pcRows = pcRes.data || [];
    if (mahk !== null) {
      const f = pcRows.filter((p) => p.mahk != null && Number(p.mahk) === mahk);
      if (f.length > 0) pcRows = f;
    }
    if (namhoc) {
      const f = pcRows.filter((p) => p.namhoc && String(p.namhoc) === namhoc);
      if (f.length > 0) pcRows = f;
    }
    const pcMap = new Map(pcRows.map((p) => [p.mapc, p]));

    const currentMatkbs = (tkbRes.data || []).map((r) => r.matkb).filter(Boolean);
    const { data: linkedMakeups, error: linkedMakeupsError } = currentMatkbs.length
      ? await supabase
        .from('thoi_khoa_bieu')
        .select('*')
        .in('tkb_goc_id', currentMatkbs)
        .eq('trangthai', 'HOC_BU')
      : { data: [], error: null };
    if (linkedMakeupsError) throw new Error(linkedMakeupsError.message);

    // Build khung map: makhung -> { day_index, slot }
    const khungMap = new Map();
    for (const k of khungRes.data || []) {
      const dayIdx = mapDayToIndex(k.thutrongtuan);
      if (dayIdx !== null) khungMap.set(k.makhung, { day_index: dayIdx, slot: Number(k.tietbatdau) });
    }

    // Group thoi_khoa_bieu rows into sessions by status-aware session key.
    const sessMap = new Map();
    for (const row of tkbRes.data || []) {
      if (!pcMap.has(row.mapc)) continue;        // filtered out by hocky/namhoc
      const khung = khungMap.get(row.makhung);
      if (!khung) continue;
      const dayIdx = row.ngayhoc ? deriveDateDayIndex(row.ngayhoc) : khung.day_index;
      const status = normalizeScheduleStatus(row.trangthai);
      const keyRoot = status === 'HOC_BU'
        ? (row.tkb_goc_id || row.matkb)
        : `${row.mapc}|${row.maphong}|${dayIdx}|${row.ngayhoc || ''}`;
      const key = `${row.mapc}|${row.maphong}|${dayIdx}|${status}|${keyRoot}`;
      if (!sessMap.has(key)) {
        sessMap.set(key, {
          mapc: row.mapc,
          maphong: row.maphong,
          day_index: dayIdx,
          slots: [],
          rows: [],
          status,
          tkb_goc_id: row.tkb_goc_id || null,
          ngayhoc: row.ngayhoc || null,
          lydo: row.lydo || null,
        });
      }
      sessMap.get(key).slots.push(khung.slot);
      sessMap.get(key).rows.push(row);
    }

    const makeupsByRoot = new Map();
    for (const row of linkedMakeups || []) {
      if (!row.tkb_goc_id) continue;
      if (!makeupsByRoot.has(row.tkb_goc_id)) makeupsByRoot.set(row.tkb_goc_id, []);
      makeupsByRoot.get(row.tkb_goc_id).push(row);
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
      const sortedRows = sess.rows.sort((a, b) => {
        const ak = khungMap.get(a.makhung);
        const bk = khungMap.get(b.makhung);
        return (ak?.slot || 0) - (bk?.slot || 0);
      });
      const matkb = sortedRows[0]?.matkb || null;
      const makeupRows = makeupsByRoot.get(matkb) || [];
      const makeupSlots = makeupRows
        .map((r) => khungMap.get(r.makhung)?.slot)
        .filter((v) => v != null)
        .sort((a, b) => a - b);
      const makeupInfo = makeupRows.length ? {
        matkb: makeupRows[0].matkb,
        tuanhoc: makeupRows[0].tuanhoc,
        ngayhoc: makeupRows[0].ngayhoc,
        maphong: makeupRows[0].maphong,
        tiet_start: makeupSlots[0],
        tiet_end: makeupSlots[makeupSlots.length - 1],
      } : null;

      let originalInfo = null;
      if (sess.tkb_goc_id) {
        const { data: originalRow } = await supabase
          .from('thoi_khoa_bieu')
          .select('*')
          .eq('matkb', sess.tkb_goc_id)
          .maybeSingle();
        if (originalRow) {
          originalInfo = {
            matkb: originalRow.matkb,
            tuanhoc: originalRow.tuanhoc,
            ngayhoc: originalRow.ngayhoc,
          };
        }
      }
      lich.push({
        matkb,
        matkb_list: sortedRows.map((r) => r.matkb),
        thu_idx:   sess.day_index,
        tiet_start: sess.slots[0],
        tiet_end:   sess.slots[sess.slots.length - 1],
        makhung: sortedRows[0]?.makhung,
        mamon:  pc.mamon,
        tenmon: mon.tenmon  || pc.mamon,
        magv:   pc.magv,
        tengv:  gv.tengv    || pc.magv,
        malop:  pc.malop,
        tenlop: lop.tenlop  || pc.malop,
        maphong: sess.maphong,
        loai,
        tuanhoc: sortedRows[0]?.tuanhoc,
        ngayhoc: sess.ngayhoc,
        trangthai: sess.status,
        tkb_goc_id: sess.tkb_goc_id,
        lydo: sess.lydo,
        hoc_bu: makeupInfo,
        bu_cho: originalInfo,
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
      khung_list:  (khungRes.data || []).map((k) => ({
        makhung: k.makhung,
        thutrongtuan: k.thutrongtuan,
        thu_idx: mapDayToIndex(k.thutrongtuan),
        tietbatdau: Number(k.tietbatdau),
        tietketthuc: Number(k.tietketthuc),
        buoihoc: k.buoihoc,
      })),
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Xóa sạch 3 bảng về trạng thái trống: thoi_khoa_bieu → phan_cong_giang_day → khung_thoi_gian
// Thứ tự xóa theo FK: thoi_khoa_bieu tham chiếu cả phan_cong và khung_thoi_gian nên phải xóa trước.
app.post('/api/seed/reset', async (req, res) => {
  try {
    // 1. Xóa thoi_khoa_bieu (FK → phan_cong_giang_day.mapc, FK → khung_thoi_gian.makhung)
    const { error: e1 } = await supabase.from('thoi_khoa_bieu').delete().neq('matkb', '');
    if (e1) throw new Error('thoi_khoa_bieu: ' + e1.message);

    // 2. Xóa phan_cong_giang_day
    const { error: e2 } = await supabase.from('phan_cong_giang_day').delete().neq('mapc', '');
    if (e2) throw new Error('phan_cong_giang_day: ' + e2.message);

    // 3. Xóa khung_thoi_gian (makhung là int4 PK, xóa tất cả hàng có PK > 0)
    const { error: e3 } = await supabase.from('khung_thoi_gian').delete().gt('makhung', 0);
    if (e3) throw new Error('khung_thoi_gian: ' + e3.message);

    return res.json({
      ok: true,
      message: 'Đã xóa sạch 3 bảng: thoi_khoa_bieu, phan_cong_giang_day, khung_thoi_gian. Dữ liệu về trạng thái trống.',
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

    const needsKhung = !khungCount || khungCount < 84;
    const needsPC    = !pcCount    || pcCount    === 0;

    if (needsKhung || needsPC) {
      console.log('[AutoSeed] Phat hien bang trong, dang seed...');
      if (needsKhung) {
        const r = spawnSync('node', [path.join(__dirname, 'scripts/bootstrap_time_slots.js')],
          { stdio: 'pipe', encoding: 'utf8', cwd: __dirname });
        if (r.status !== 0) {
          console.warn('[AutoSeed] bootstrap_time_slots that bai:\n', r.stderr || r.stdout);
        } else {
          console.log('[AutoSeed] bootstrap_time_slots OK.');
        }
      }
      if (needsPC) {
        const r = spawnSync('node', [path.join(__dirname, 'scripts/bootstrap_assignments.js')],
          { stdio: 'pipe', encoding: 'utf8', cwd: __dirname });
        if (r.status !== 0) {
          console.warn('[AutoSeed] bootstrap_assignments that bai:\n', r.stderr || r.stdout);
          console.warn('[AutoSeed] → Hay chay "npm run seed:all" thu cong, sau do thu lai.');
        } else {
          console.log('[AutoSeed] bootstrap_assignments OK.');
        }
      }
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


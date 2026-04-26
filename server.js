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

function normalizeTeacherStatus(value) {
  const text = stripVietnamese(value || 'HOAT_DONG');
  if (['tamngung', 'inactive', 'ngung', 'pause', 'paused'].includes(text)) {
    return 'TAM_NGUNG';
  }
  return 'HOAT_DONG';
}

function parseTeacherStatus(value) {
  const text = stripVietnamese(value);
  if (['hoatdong', 'danggiangday', 'active', '1', 'true'].includes(text)) return 'HOAT_DONG';
  if (['tamngung', 'inactive', 'ngung', 'pause', 'paused', '0', 'false'].includes(text)) return 'TAM_NGUNG';
  return null;
}

function isActiveTeacher(row) {
  return normalizeTeacherStatus(row?.trangthai) === 'HOAT_DONG';
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

function getCompatibleRoomTypes(mon, classType = null, pc = null, monMap = null) {
  const sessionType = classType || normalizeAssignmentType(pc || {}, new Map([[mon?.mamon, mon]].filter(([k]) => k)));
  const hasPractice = Number(mon?.sotietthuchanh || 0) > 0 || hasRelatedPracticeSubject(mon, monMap);
  const specialTH = specialRoomMamons().has(String(pc?.mamon || '').toUpperCase());

  if (sessionType === 'TH') return ['TH'];
  if (sessionType === 'LT') {
    if (specialTH) return ['TH'];
    if (hasPractice) return ['LT', 'TH'];
    return ['LT'];
  }
  return ['LT'];
}

function roomCompatibilityMessage(pc, mon, room, monMap = null) {
  const compatibleTypes = getCompatibleRoomTypes(
    mon,
    normalizeAssignmentType(pc, new Map([[mon?.mamon, mon]].filter(([k]) => k))),
    pc,
    monMap,
  );
  return compatibleTypes.includes(normalizeRoomType(room?.loaiphong)) ? null : 'Phòng không đúng loại yêu cầu.';
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

function gaSessionConfigForSubject(mon, type = 'LT') {
  const total = Number(mon?.tongsotiet || 0);
  const lt = Number(mon?.sotietlythuyet || 0);
  const th = Number(mon?.sotietthuchanh || 0);
  const practiceType = type === 'TH' || (lt === 0 && th > 0);
  if (practiceType) return { sobuoimoituan: 1, sotietmoibuoi: 5 };
  const special5 = specialRoomMamons().has(String(mon?.mamon || '').toUpperCase())
    || (process.env.SPECIAL_5TIET_MAMONS || '').split(',').map((s) => s.trim().toUpperCase()).includes(String(mon?.mamon || '').toUpperCase());
  if (special5 || th > 0 || Number(mon?.sotietthuchanh || 0) > 0) {
    return { sobuoimoituan: 1, sotietmoibuoi: 5 };
  }
  return total >= 45
    ? { sobuoimoituan: 2, sotietmoibuoi: 3 }
    : { sobuoimoituan: 1, sotietmoibuoi: 3 };
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

  const [pcRes, monRes, roomRes, khungRes, gvRes] = await Promise.all([
    supabase.from('phan_cong_giang_day').select('*').eq('mapc', row.mapc).maybeSingle(),
    supabase.from('mon_hoc').select('*'),
    supabase.from('phong_hoc').select('*'),
    supabase.from('khung_thoi_gian').select('*'),
    supabase.from('giang_vien').select('magv, tengv, trangthai'),
  ]);
  const errs = [pcRes.error, monRes.error, roomRes.error, khungRes.error, gvRes.error].filter(Boolean);
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
  const teacherMap = new Map((gvRes.data || []).map((g) => [g.magv, g]));

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
    teacher: teacherMap.get(pcRes.data.magv) || null,
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

function makeupOriginalPayload(ctx) {
  const sessionType = normalizeAssignmentType(ctx.pc, new Map([[ctx.mon?.mamon, ctx.mon]].filter(([k]) => k)));
  return {
    matkb: ctx.row.matkb,
    mapc: ctx.pc.mapc,
    mamon: ctx.pc.mamon,
    tenmon: ctx.mon?.tenmon || ctx.pc.mamon,
    malop: ctx.pc.malop,
    magv: ctx.pc.magv,
    tengv: ctx.teacher?.tengv || ctx.pc.magv,
    sotietmoibuoi: sessionDurationFromAssignment(ctx.pc, ctx.originalRows.length),
    required_room_types: getCompatibleRoomTypes(ctx.mon, sessionType, ctx.pc, ctx.monMap),
    tuanbatdau: normalizeWeekBounds(ctx.pc).start,
    tuanketthuc: normalizeWeekBounds(ctx.pc).end,
  };
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

async function restoreScheduleRows(rows) {
  for (const row of rows || []) {
    const { error } = await supabase
      .from('thoi_khoa_bieu')
      .update({
        trangthai: row.trangthai,
        lydo: row.lydo || null,
        ngaycapnhat: row.ngaycapnhat || null,
      })
      .eq('matkb', row.matkb);
    if (error) console.error('[Rollback] restore schedule failed:', row.matkb, error.message);
  }
}

async function assertTeacherCanBeAssigned(magv) {
  const { data, error } = await supabase
    .from('giang_vien')
    .select('magv, tengv, trangthai')
    .eq('magv', magv)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Không tìm thấy giảng viên.');
  if (!isActiveTeacher(data)) {
    throw new Error('Không thể phân công vì giảng viên đang tạm ngưng.');
  }
  return data;
}

async function findPausedTeacherAssignments(assignments, monMap = null, teacherMap = null) {
  const magvs = [...new Set((assignments || []).map((pc) => pc.magv).filter(Boolean))];
  if (magvs.length === 0) return [];
  let gvMap = teacherMap;
  if (!gvMap) {
    const { data, error } = await supabase
      .from('giang_vien')
      .select('magv, tengv, trangthai')
      .in('magv', magvs);
    if (error) throw new Error(error.message);
    gvMap = new Map((data || []).map((g) => [g.magv, g]));
  }
  return (assignments || [])
    .filter((pc) => {
      const gv = gvMap.get(pc.magv);
      return gv && !isActiveTeacher(gv);
    })
    .map((pc) => {
      const gv = gvMap.get(pc.magv) || {};
      const mon = monMap?.get(pc.mamon) || {};
      return {
        mapc: pc.mapc,
        magv: pc.magv,
        tengv: gv.tengv || pc.magv,
        mamon: pc.mamon,
        tenmon: mon.tenmon || pc.mamon,
        malop: pc.malop,
      };
    });
}

async function deleteTeacherSafely(magv) {
  const { data: assignments, error: pcError } = await supabase
    .from('phan_cong_giang_day')
    .select('mapc')
    .eq('magv', magv);
  if (pcError) throw new Error(pcError.message);

  const mapcList = (assignments || []).map((pc) => pc.mapc).filter(Boolean);
  let scheduleCount = 0;
  if (mapcList.length > 0) {
    const { count, error: tkbError } = await supabase
      .from('thoi_khoa_bieu')
      .select('*', { count: 'exact', head: true })
      .in('mapc', mapcList);
    if (tkbError) throw new Error(tkbError.message);
    scheduleCount = count || 0;
  }

  if ((assignments || []).length > 0 || scheduleCount > 0) {
    return {
      deleted: false,
      status: 409,
      message: 'Không thể xóa giảng viên vì giảng viên này đã có phân công giảng dạy hoặc đã được xếp thời khóa biểu. Vui lòng dùng chức năng Tạm ngưng.',
    };
  }

  const { error } = await supabase.from('giang_vien').delete().eq('magv', magv);
  if (error) throw new Error(error.message);
  return { deleted: true, status: 200, message: 'Xóa giảng viên thành công.' };
}

async function nextAssignmentCodes(count) {
  const { data, error } = await supabase.from('phan_cong_giang_day').select('mapc');
  if (error) throw new Error(error.message);
  const maxNumber = (data || []).reduce((max, row) => {
    const match = String(row.mapc || '').match(/^PC(\d+)$/i);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return Array.from({ length: count }, (_, idx) => `PC${String(maxNumber + idx + 1).padStart(5, '0')}`);
}

async function prepareGaAssignmentsForSelection({ mahk, malops, mamons }) {
  const selectedLops = [].concat(malops || []).map(String).filter(Boolean);
  const selectedMons = [].concat(mamons || []).map(String).filter(Boolean);
  if (selectedLops.length === 0 || selectedMons.length === 0) {
    return { active: false, duplicates: [], allowed: [] };
  }

  let pcQuery = supabase
    .from('phan_cong_giang_day')
    .select('mapc, mahk, malop, mamon')
    .in('malop', selectedLops)
    .in('mamon', selectedMons);
  if (mahk === null || mahk === undefined) pcQuery = pcQuery.is('mahk', null);
  else pcQuery = pcQuery.eq('mahk', Number(mahk));
  const { data: existingPc, error: pcError } = await pcQuery;
  if (pcError) throw new Error(pcError.message);

  const existingByPair = new Map((existingPc || []).map((pc) => [`${pc.malop}|${pc.mamon}`, pc]));
  let scheduledMapcs = new Set();
  const existingMapcs = (existingPc || []).map((pc) => pc.mapc).filter(Boolean);
  if (existingMapcs.length > 0) {
    let tkbQuery = supabase
      .from('thoi_khoa_bieu')
      .select('mapc')
      .in('mapc', existingMapcs)
      .in('trangthai', ['DANG_HOC', 'TAM_NGUNG', 'HOC_BU']);
    if (mahk === null || mahk === undefined) tkbQuery = tkbQuery.is('mahk', null);
    else tkbQuery = tkbQuery.eq('mahk', Number(mahk));
    const { data: tkbRows, error: tkbError } = await tkbQuery;
    if (tkbError) throw new Error(tkbError.message);
    scheduledMapcs = new Set((tkbRows || []).map((row) => row.mapc));
  }

  const duplicates = [];
  const allowed = [];
  for (const malop of selectedLops) {
    for (const mamon of selectedMons) {
      const pc = existingByPair.get(`${malop}|${mamon}`);
      if (pc) {
        if (scheduledMapcs.has(pc.mapc)) {
          duplicates.push({
            malop,
            mamon,
            mapc: pc.mapc,
            da_xep: true,
            reason: 'Đã có thời khóa biểu trong học kỳ này',
          });
        } else {
          allowed.push({ malop, mamon, mapc: pc.mapc, existing: true });
        }
      } else {
        allowed.push({ malop, mamon });
      }
    }
  }

  if (allowed.length === 0) {
    return { active: true, duplicates, allowed };
  }

  const newPairs = allowed.filter((pair) => !pair.existing);
  if (newPairs.length === 0) {
    return { active: true, duplicates, allowed };
  }

  const [{ data: monRows, error: monError }, { data: teacherRows, error: teacherError }] = await Promise.all([
    supabase.from('mon_hoc').select('*').in('mamon', [...new Set(newPairs.map((p) => p.mamon))]),
    supabase.from('giang_vien').select('magv, trangthai').order('magv', { ascending: true }),
  ]);
  const errors = [monError, teacherError].filter(Boolean);
  if (errors.length) throw new Error(errors.map((e) => e.message).join(' | '));
  const monMap = new Map((monRows || []).map((m) => [m.mamon, m]));
  const teachers = (teacherRows || []).filter((gv) => isActiveTeacher(gv));
  if (teachers.length === 0) throw new Error('Không có giảng viên hoạt động để tạo phân công.');

  const codes = await nextAssignmentCodes(newPairs.length);
  const rows = newPairs.map((pair, idx) => {
    const mon = monMap.get(pair.mamon);
    if (!mon) throw new Error(`Không tìm thấy môn học ${pair.mamon}.`);
    const teacher = teachers[idx % teachers.length];
    const loai = normalizeAssignmentType({ mamon: pair.mamon, loaiphong: mon.loaiphong }, monMap);
    const cfg = gaSessionConfigForSubject(mon, loai);
    return {
      mapc: codes[idx],
      mahk: mahk === null || mahk === undefined ? null : Number(mahk),
      malop: pair.malop,
      mamon: pair.mamon,
      magv: teacher.magv,
      sobuoimoituan: cfg.sobuoimoituan,
      sotietmoibuoi: cfg.sotietmoibuoi,
      loaiphong: loai,
    };
  });

  const { error: insertError } = await supabase.from('phan_cong_giang_day').insert(rows);
  if (insertError) throw new Error(insertError.message);
  return {
    active: true,
    duplicates,
    allowed: allowed.map((pair) => ({
      malop: pair.malop,
      mamon: pair.mamon,
      mapc: pair.mapc || rows.find((row) => row.malop === pair.malop && row.mamon === pair.mamon)?.mapc,
      existing: !!pair.existing,
    })),
  };
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
  let teachers = (data || []).map((row) => ({
    ...row,
    trangthai: normalizeTeacherStatus(row.trangthai),
  }));
  if (['1', 'true', 'HOAT_DONG'].includes(String(req.query.active || '').trim())) {
    teachers = teachers.filter((row) => isActiveTeacher(row));
  }
  res.json(teachers);
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
      trangthai: normalizeTeacherStatus(firstValue(body, ['TrangThai', 'trangthai'])),
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
    };
    const statusValue = firstValue(body, ['TrangThai', 'trangthai']);
    if (statusValue !== undefined) row.trangthai = normalizeTeacherStatus(statusValue);

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
    const result = await deleteTeacherSafely(req.params.magv);
    return res.status(result.status).json({
      ok: result.deleted,
      success: result.deleted,
      error: result.deleted ? undefined : result.message,
      message: result.message,
    });
  } catch (error) {
    return sendSupabaseError(res, error);
  }
});

app.delete('/api/giang-vien/:magv', async (req, res) => {
  try {
    const result = await deleteTeacherSafely(req.params.magv);
    return res.status(result.status).json({
      success: result.deleted,
      message: result.message,
    });
  } catch (error) {
    return sendSupabaseError(res, error);
  }
});

app.patch('/api/giang-vien/:magv/trang-thai', async (req, res) => {
  try {
    const trangthai = parseTeacherStatus(req.body?.trangthai);
    if (!trangthai) {
      return res.status(400).json({ ok: false, error: 'Trạng thái giảng viên không hợp lệ.' });
    }
    const { data, error } = await supabase
      .from('giang_vien')
      .update({ trangthai })
      .eq('magv', req.params.magv)
      .select('*')
      .single();
    if (error) return sendSupabaseError(res, error);
    return res.json({ ok: true, success: true, message: 'Cập nhật trạng thái giảng viên thành công.', data });
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

app.post('/api/phan-cong/by-lops', async (req, res) => {
  try {
    const body = req.body || {};
    const malops = [].concat(body.malops || body.malop || []).map(String).filter(Boolean);
    const mahk = body.mahk !== undefined && body.mahk !== null && body.mahk !== ''
      ? Number(body.mahk)
      : null;

    if (malops.length === 0) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn ít nhất một lớp.', data: [] });
    }
    if (body.mahk !== undefined && body.mahk !== null && body.mahk !== '' && !Number.isFinite(mahk)) {
      return res.status(400).json({ success: false, message: 'Mã học kỳ không hợp lệ.', data: [] });
    }

    let pcQuery = supabase
      .from('phan_cong_giang_day')
      .select('*')
      .in('malop', malops);
    if (mahk !== null) pcQuery = pcQuery.eq('mahk', mahk);

    const [{ data: pcs, error: pcError }, { data: mons, error: monError }, { data: teachers, error: gvError }] = await Promise.all([
      pcQuery,
      supabase.from('mon_hoc').select('mamon, tenmon'),
      supabase.from('giang_vien').select('magv, tengv, trangthai'),
    ]);
    const errors = [pcError, monError, gvError].filter(Boolean);
    if (errors.length) throw new Error(errors.map((e) => e.message).join(' | '));

    const rows = pcs || [];
    const mapcs = rows.map((pc) => pc.mapc).filter(Boolean);
    let scheduledMapcs = new Set();
    if (mapcs.length > 0) {
      let tkbQuery = supabase
        .from('thoi_khoa_bieu')
        .select('mapc, mahk, trangthai')
        .in('mapc', mapcs)
        .in('trangthai', ['DANG_HOC', 'TAM_NGUNG', 'HOC_BU']);
      if (mahk !== null) tkbQuery = tkbQuery.eq('mahk', mahk);
      const { data: tkbs, error: tkbError } = await tkbQuery;
      if (tkbError) throw new Error(tkbError.message);
      scheduledMapcs = new Set((tkbs || []).map((row) => row.mapc));
    }

    const monMap = new Map((mons || []).map((mon) => [mon.mamon, mon]));
    const teacherMap = new Map((teachers || []).map((gv) => [gv.magv, gv]));
    const data = rows.map((pc) => {
      const mon = monMap.get(pc.mamon) || {};
      const gv = teacherMap.get(pc.magv) || {};
      return {
        mapc: pc.mapc,
        malop: pc.malop,
        mamon: pc.mamon,
        tenmon: mon.tenmon || pc.mamon,
        magv: pc.magv,
        tengv: gv.tengv || pc.magv,
        sotietmoibuoi: pc.sotietmoibuoi,
        sobuoimoituan: pc.sobuoimoituan,
        tuanbatdau: pc.tuanbatdau,
        tuanketthuc: pc.tuanketthuc,
        mahk: pc.mahk,
        da_xep: scheduledMapcs.has(pc.mapc),
      };
    });

    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message, data: [] });
  }
});

app.post('/api/phan-cong', async (req, res) => {
  try {
    const body = req.body || {};
    const magv = optionalText(firstValue(body, ['MaGV', 'magv']));
    if (!magv) throw new Error('Vui lòng chọn giảng viên.');
    await assertTeacherCanBeAssigned(magv);
    const row = {
      mapc: optionalText(firstValue(body, ['MaPC', 'mapc'])) || crypto.randomUUID(),
      mahk: parseOptionalNumber(firstValue(body, ['MaHK', 'mahk']), 'mahk'),
      malop: optionalText(firstValue(body, ['MaLop', 'malop'])),
      mamon: optionalText(firstValue(body, ['MaMon', 'mamon'])),
      magv,
      sobuoimoituan: parseBodyNumber(firstValue(body, ['SoBuoiMoiTuan', 'sobuoimoituan']), 'sobuoimoituan'),
      sotietmoibuoi: parseBodyNumber(firstValue(body, ['SoTietMoiBuoi', 'sotietmoibuoi']), 'sotietmoibuoi'),
      loaiphong: optionalText(firstValue(body, ['LoaiPhong', 'loaiphong'])),
      namhoc: optionalText(firstValue(body, ['NamHoc', 'namhoc'])),
      tuanbatdau: parseBodyNumber(firstValue(body, ['TuanBatDau', 'tuanbatdau']) ?? 1, 'tuanbatdau'),
      tuanketthuc: parseOptionalNumber(firstValue(body, ['TuanKetThuc', 'tuanketthuc']), 'tuanketthuc'),
    };
    const { data, error } = await supabase.from('phan_cong_giang_day').insert(row).select('*').single();
    if (error) return sendSupabaseError(res, error);
    return res.status(201).json(data);
  } catch (err) {
    return sendSupabaseError(res, err);
  }
});

app.put('/api/phan-cong/:mapc', async (req, res) => {
  try {
    const body = req.body || {};
    const magv = optionalText(firstValue(body, ['MaGV', 'magv']));
    if (magv) await assertTeacherCanBeAssigned(magv);
    const row = {};
    for (const [field, keys] of Object.entries({
      mahk: ['MaHK', 'mahk'],
      malop: ['MaLop', 'malop'],
      mamon: ['MaMon', 'mamon'],
      magv: ['MaGV', 'magv'],
      loaiphong: ['LoaiPhong', 'loaiphong'],
      namhoc: ['NamHoc', 'namhoc'],
    })) {
      const value = firstValue(body, keys);
      if (value !== undefined) row[field] = optionalText(value);
    }
    if (firstValue(body, ['SoBuoiMoiTuan', 'sobuoimoituan']) !== undefined) {
      row.sobuoimoituan = parseBodyNumber(firstValue(body, ['SoBuoiMoiTuan', 'sobuoimoituan']), 'sobuoimoituan');
    }
    if (firstValue(body, ['SoTietMoiBuoi', 'sotietmoibuoi']) !== undefined) {
      row.sotietmoibuoi = parseBodyNumber(firstValue(body, ['SoTietMoiBuoi', 'sotietmoibuoi']), 'sotietmoibuoi');
    }
    if (firstValue(body, ['TuanBatDau', 'tuanbatdau']) !== undefined) {
      row.tuanbatdau = parseBodyNumber(firstValue(body, ['TuanBatDau', 'tuanbatdau']), 'tuanbatdau');
    }
    if (firstValue(body, ['TuanKetThuc', 'tuanketthuc']) !== undefined) {
      row.tuanketthuc = parseOptionalNumber(firstValue(body, ['TuanKetThuc', 'tuanketthuc']), 'tuanketthuc');
    }
    const { data, error } = await supabase
      .from('phan_cong_giang_day')
      .update(row)
      .eq('mapc', req.params.mapc)
      .select('*')
      .single();
    if (error) return sendSupabaseError(res, error);
    return res.json(data);
  } catch (err) {
    return sendSupabaseError(res, err);
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
      teacher_available: result.teacher_available ?? result.available,
      class_available: result.class_available ?? result.available,
      room_available: result.room_available ?? result.available,
    });
  } catch (error) {
    return res.status(400).json({ available: false, message: error.message });
  }
});

app.post('/api/tkb/:matkb/available-makeup-slots', async (req, res) => {
  try {
    const body = req.body || {};
    const ctx = await fetchScheduleContext(req.params.matkb);
    if (normalizeScheduleStatus(ctx.row.trangthai) === 'HOC_BU') {
      return res.status(400).json({ success: false, message: 'Không thể tạo học bù từ một buổi học bù.', slots: [] });
    }
    const slots = await buildAvailableMakeupSlots({
      matkbGoc: req.params.matkb,
      tuanhoc: body.tuanhoc,
      ngayhoc: body.ngayhoc,
      excludeMatkb: body.exclude_matkb || null,
    });
    const normalizedSlots = slots.map((slot) => {
      const availableRooms = slot.rooms?.available_rooms || [];
      const teacher = {
        available: !!slot.teacher?.available,
        message: slot.teacher?.available ? 'Giảng viên rảnh' : 'Giảng viên bận',
      };
      const klass = {
        available: !!slot.class?.available,
        message: slot.class?.available ? 'Lớp rảnh' : 'Lớp đang học',
      };
      const rooms = {
        available: availableRooms.length > 0,
        available_rooms: availableRooms,
        message: availableRooms.length
          ? `Có ${availableRooms.length} phòng trống phù hợp`
          : 'Không có phòng trống phù hợp',
      };
      const selectable = teacher.available && klass.available && rooms.available;
      const reason = selectable
        ? 'GV rảnh, lớp rảnh, có phòng trống phù hợp'
        : [teacher.message, klass.message, rooms.message]
            .filter((m) => !['Giảng viên rảnh', 'Lớp rảnh'].includes(m))
            .join('; ');
      return {
        ...slot,
        label: `Tiết ${slot.tietbatdau}-${slot.tietketthuc}`,
        teacher,
        class: klass,
        rooms,
        selectable,
        reason,
      };
    });
    return res.json({
      ok: true,
      success: true,
      original: makeupOriginalPayload(ctx),
      slots: normalizedSlots,
    });
  } catch (error) {
    return res.status(400).json({ ok: false, success: false, message: error.message, slots: [] });
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

    const originalSnapshots = ctx.originalRows.map((r) => ({
      matkb: r.matkb,
      trangthai: r.trangthai,
      lydo: r.lydo,
      ngaycapnhat: r.ngaycapnhat,
    }));
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
      return res.status(400).json({ success: false, message: 'Buổi học này đã có lịch học bù. Vui lòng chỉnh lịch học bù hiện tại.' });
    }
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

    const originalSnapshots = ctx.originalRows.map((r) => ({
      matkb: r.matkb,
      trangthai: r.trangthai,
      lydo: r.lydo,
      ngaycapnhat: r.ngaycapnhat,
    }));
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
    if (insertError) {
      await restoreScheduleRows(originalSnapshots);
      throw new Error(insertError.message);
    }

    try {
      await writeScheduleHistory({
        matkbGoc: matkb,
        matkbMoi: makeupRows[0].matkb,
        hanhdong: 'TAO_HOC_BU',
        lydo: body.lydo,
        nguoithuchien: body.nguoithuchien,
      });
    } catch (historyError) {
      await supabase.from('thoi_khoa_bieu').delete().in('matkb', makeupRows.map((row) => row.matkb));
      await restoreScheduleRows(originalSnapshots);
      throw historyError;
    }

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

// Trả về trạng thái xếp lịch per-MAPC (không aggregate theo mamon).
// Query param: ?mahk=<số> để lọc theo học kỳ (tùy chọn).
app.get('/api/ga/mon-status', async (req, res) => {
  try {
    const mahk = req.query.mahk !== undefined && req.query.mahk !== ''
      ? Number(req.query.mahk)
      : null;

    // Lấy phan_cong theo mahk nếu có
    let pcQ = supabase
      .from('phan_cong_giang_day')
      .select('mapc, malop, mamon, sobuoimoituan, sotietmoibuoi, mahk');
    if (mahk !== null) pcQ = pcQ.eq('mahk', mahk);

    // Lấy TKB theo mahk nếu có — chỉ đếm dòng đang hoạt động hoặc đã xếp
    let tkbQ = supabase
      .from('thoi_khoa_bieu')
      .select('mapc, mahk');
    if (mahk !== null) tkbQ = tkbQ.eq('mahk', mahk);

    const [pcRes, monRes, tkbRes] = await Promise.all([
      pcQ,
      supabase.from('mon_hoc').select('mamon, tongsotiet'),
      tkbQ,
    ]);

    const monMap = new Map((monRes.data || []).map(m => [m.mamon, m]));

    // scheduledCount: mapc → số buổi đã có trong thoi_khoa_bieu (cùng mahk)
    const scheduledCount = {};
    for (const row of tkbRes.data || []) {
      scheduledCount[row.mapc] = (scheduledCount[row.mapc] || 0) + 1;
    }

    // Trả về 1 entry per mapc — KHÔNG aggregate nhiều mapc chung mamon
    const result = (pcRes.data || []).map(pc => {
      const tongsotiet  = Number(monMap.get(pc.mamon)?.tongsotiet || 0);
      const sessionCount = scheduledCount[pc.mapc] || 0;

      // Quy đổi số buổi → số tiết để so sánh đúng đơn vị với tongsotiet.
      // VD: 3 buổi × sotietmoibuoi=5 = 15 tiết → đúng bằng tongsotiet=15 → exhausted=true.
      const scheduledTiet = Math.min(tongsotiet, sessionCount * Number(pc.sotietmoibuoi || 1));
      const remaining     = Math.max(0, tongsotiet - scheduledTiet);

      return {
        mapc         : pc.mapc,
        malop        : pc.malop,
        mamon        : pc.mamon,
        mahk         : pc.mahk,
        sobuoimoituan: pc.sobuoimoituan,
        sotietmoibuoi: pc.sotietmoibuoi,
        tongsotiet,
        scheduled    : scheduledTiet,   // tiết đã xếp (đã quy đổi)
        remaining,
        // exhausted = true khi tất cả tiết đã có trong TKB (cùng mahk)
        exhausted    : tongsotiet > 0 && remaining === 0,
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
    const malops = [].concat(req.body.malop || []).map(String).filter(Boolean);
    const mamons = [].concat(req.body.mamon || []).map(String).filter(Boolean);
    const hasExplicitSelection = malops.length > 0 && mamons.length > 0;

    {
      const { count } = await supabase
        .from('phan_cong_giang_day').select('*', { count: 'exact', head: true });
      if ((!count || count === 0) && !hasExplicitSelection) {
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

    const selectionPrep = await prepareGaAssignmentsForSelection({
      mahk: parsedMahk,
      malops,
      mamons,
    });
    if (selectionPrep.active && selectionPrep.allowed.length === 0) {
      return res.status(409).json({
        ok: false,
        success: false,
        message: 'Một số lớp-môn đã được xếp thời khóa biểu.',
        error: 'Một số lớp-môn đã được xếp thời khóa biểu.',
        duplicates: selectionPrep.duplicates,
        allowed: [],
      });
    }

    const { rawData, khungThoiGian } = await getSupabaseGaInput({ mahk: parsedMahk, namhoc });
    const monMap = new Map((rawData.mon_hoc || []).map((m) => [m.mamon, m]));
    const teacherMap = new Map((rawData.giang_vien || []).map((g) => [g.magv, g]));
    const pausedAssignmentsAll = await findPausedTeacherAssignments(
      rawData.phan_cong_giang_day || [],
      monMap,
      teacherMap,
    );
    if (false && pausedAssignmentsAll.length > 0) {
      return res.status(400).json({
        ok: false,
        error: 'Không thể tạo thời khóa biểu vì có phân công sử dụng giảng viên đang tạm ngưng. Vui lòng đổi giảng viên hoặc kích hoạt lại giảng viên.',
        invalid_assignments: pausedAssignmentsAll,
      });
    }

    // ── Lọc theo malop/mamon (hỗ trợ cả string lẫn array) ───────────────
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
    // Build thToLtMamon: mamon_TH → mamon_LT, dựa trên tenmon.
    // TH tenmon = LT tenmon + "-Thực hành" (quy tắc đặt tên trong DB này).
    // Đây là cách link duy nhất đúng vì mamon là dãy số, không có suffix _LT/_TH.
    if (selectionPrep.active) {
      const allowedPairs = new Set(selectionPrep.allowed.map((p) => `${p.malop}|${p.mamon}`));
      rawData.phan_cong_giang_day = (rawData.phan_cong_giang_day || []).filter(
        (pc) => allowedPairs.has(`${pc.malop}|${pc.mamon}`)
      );
    }

    const pausedAssignments = await findPausedTeacherAssignments(
      rawData.phan_cong_giang_day || [],
      monMap,
      teacherMap,
    );
    if (pausedAssignments.length > 0) {
      return res.status(400).json({
        ok: false,
        success: false,
        error: 'Không thể tạo thời khóa biểu vì có phân công sử dụng giảng viên đang tạm ngưng. Vui lòng đổi giảng viên hoặc kích hoạt lại giảng viên.',
        message: 'Không thể tạo thời khóa biểu vì có phân công sử dụng giảng viên đang tạm ngưng. Vui lòng đổi giảng viên hoặc kích hoạt lại giảng viên.',
        invalid_assignments: pausedAssignments,
      });
    }
    rawData.giang_vien = (rawData.giang_vien || []).filter((gv) => isActiveTeacher(gv));

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
          matkb    : crypto.randomUUID(),
          tuanhoc  : w,
          mapc     : row.mapc,
          maphong  : row.maphong,
          makhung  : row.makhung,
          mahk     : parsedMahk ?? null,   // cần để /api/ga/mon-status?mahk= filter đúng
          trangthai: 'DANG_HOC',           // cần để /api/phan-cong/by-lops filter trangthai đúng
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
      duplicates: selectionPrep?.duplicates || [],
      allowed: selectionPrep?.allowed || [],
      skippedDuplicates: selectionPrep?.duplicates?.length || 0,
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
    const needsPC    = false;

    if (needsKhung || needsPC) {
      console.log('[AutoSeed] Phat hien bang khung_thoi_gian trong, dang seed khung...');
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
      console.log(`[AutoSeed] Du lieu OK: ${khungCount} khung. Khong auto-seed phan_cong (${pcCount || 0} ban ghi).`);
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


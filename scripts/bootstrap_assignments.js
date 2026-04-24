const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

function normalizeText(input) {
  if (input === null || input === undefined) return '';
  return String(input)
    .trim()
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_]+/g, '');
}

function isTeacherActive(status) {
  const value = normalizeText(status);
  if (!value) return true; // null/rỗng → coi là active
  // Chỉ loại bỏ nếu RÕ RÀNG là inactive
  const INACTIVE = ['inactive', 'khonghoatdong', 'nghi', 'nghiviec', 'ngungday', '0', 'false', 'disabled', 'locked'];
  return !INACTIVE.includes(value);
}

// 1 môn → 1 GV duy nhất cho cả LT lẫn TH
function chooseTeacher(teachers, classIdx, subjectIdx) {
  const idx = (classIdx + subjectIdx) % teachers.length;
  return teachers[idx];
}

// use5Tiet: true nếu LT có TH kèm HOẶC nằm trong nhóm đặc biệt (env SEED_5TIET_LT_ONLY)
// sotietmoibuoi=5 → bắt buộc sobuoimoituan=1 (GA rule)
function sessionsForType(totalPeriods, type, use5Tiet = false) {
  const total = Number(totalPeriods || 0);
  if (total <= 0) return null;

  if (type === 'LT') {
    if (use5Tiet) {
      return { sobuoimoituan: 1, sotietmoibuoi: 5 };
    }
    return total >= 45
      ? { sobuoimoituan: 2, sotietmoibuoi: 3 }
      : { sobuoimoituan: 1, sotietmoibuoi: 3 };
  }

  // TH luôn 5 tiết/buổi × 1 buổi/tuần
  return { sobuoimoituan: 1, sotietmoibuoi: 5 };
}

// Mỗi cặp (lớp, môn) tạo tối đa 2 phan_cong: 1 LT + 1 TH (nếu môn có cả 2).
// Cùng GV phụ trách cả LT lẫn TH của môn đó cho lớp đó.
function buildAssignments(classes, subjects, teachers, mahk) {
  const assignments = [];
  let seq = 1;
  const stripSfx = (m) => String(m).replace(/_(LT|TH)$/i, '');

  // Tập các base mamon CÓ học phần TH trong mon_hoc
  const basesWithTH = new Set(
    subjects
      .filter(m => String(m.mamon).toUpperCase().endsWith('_TH'))
      .map(m => stripSfx(m.mamon))
  );

  // Nhóm đặc biệt: LT-only nhưng cần sotietmoibuoi=5 (cấu hình qua env SEED_5TIET_LT_ONLY)
  const special5Tiet = new Set(
    (process.env.SEED_5TIET_LT_ONLY || '')
      .split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
  );
  if (special5Tiet.size > 0) {
    console.log(`[bootstrap] Nhom LT-only 5 tiet/buoi: ${[...special5Tiet].join(', ')}`);
  }

  classes.forEach((lop, classIdx) => {
    // Map: baseMamon → teacher (đảm bảo LT và TH cùng môn có cùng GV)
    const classTeacherMap = new Map();

    subjects.forEach((mon, subjectIdx) => {
      const baseMamon = stripSfx(mon.mamon);
      if (!classTeacherMap.has(baseMamon)) {
        classTeacherMap.set(baseMamon, chooseTeacher(teachers, classIdx, subjectIdx));
      }
      // Đọc suffix _LT / _TH từ mamon để xác định loại buổi
      // VD: mamon="IT01_LT" → chỉ tạo LT, "IT01_TH" → chỉ tạo TH
      const mamonUpper = String(mon.mamon).toUpperCase();
      const isLTOnly   = mamonUpper.endsWith('_LT');
      const isTHOnly   = mamonUpper.endsWith('_TH');
      const tong       = Number(mon.tongsotiet || 0);

      let ltPeriods, thPeriods;
      if (isLTOnly) {
        ltPeriods = Number(mon.sotietlythuyet || 0) || tong;
        thPeriods = 0;
      } else if (isTHOnly) {
        ltPeriods = 0;
        thPeriods = Number(mon.sotietthuchanh || 0) || tong;
      } else {
        ltPeriods = Number(mon.sotietlythuyet || 0);
        thPeriods = Number(mon.sotietthuchanh || 0);
        if (ltPeriods === 0 && thPeriods === 0) ltPeriods = tong; // fallback cho môn không split
      }

      const use5Tiet = basesWithTH.has(baseMamon) || special5Tiet.has(baseMamon.toUpperCase());
      const lt = sessionsForType(ltPeriods, 'LT', use5Tiet);
      const th = sessionsForType(thPeriods, 'TH');

      // Lấy GV đã được gán cho base môn này (LT và TH dùng cùng 1 GV)
      const teacher = classTeacherMap.get(baseMamon);

      for (const item of [
        { type: 'LT', cfg: lt },
        { type: 'TH', cfg: th },
      ]) {
        if (!item.cfg) continue;

        const seqText = String(seq).padStart(5, '0');
        assignments.push({
          mapc: `PC${seqText}`,
          mahk: mahk || null,
          sobuoimoituan: item.cfg.sobuoimoituan,
          sotietmoibuoi: item.cfg.sotietmoibuoi,
          malop: lop.malop,
          mamon: mon.mamon,
          magv: teacher.magv,
        });
        seq += 1;
      }
    });
  });

  return assignments;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  // Lấy học kỳ đang mở (trangthai = "Đang mở") hoặc học kỳ đầu tiên
  const { data: hkList } = await supabase
    .from('hoc_ky').select('mahk, tenhocky, trangthai').order('mahk', { ascending: true });
  const openHK = (hkList || []).find(h => h.trangthai === 'Đang mở') || hkList?.[0];
  const mahk = openHK?.mahk || null;
  console.log(`[bootstrap] Su dung hoc ky: mahk=${mahk} (${openHK?.tenhocky || 'khong xac dinh'})`);

  const [lopRes, monRes, gvRes] = await Promise.all([
    supabase.from('lop').select('malop').order('malop', { ascending: true }),
    supabase.from('mon_hoc').select('mamon,sotietlythuyet,sotietthuchanh,tongsotiet').order('mamon', { ascending: true }),
    supabase.from('giang_vien').select('magv,trangthai').order('magv', { ascending: true }),
  ]);

  const errors = [lopRes.error, monRes.error, gvRes.error].filter(Boolean);
  if (errors.length > 0) {
    throw new Error(errors.map((e) => e.message).join(' | '));
  }

  const classes = lopRes.data || [];
  const subjects = monRes.data || [];
  const teachers = (gvRes.data || []).filter((gv) => isTeacherActive(gv.trangthai));
  if (classes.length === 0 || subjects.length === 0 || teachers.length === 0) {
    throw new Error('Du lieu lop/mon_hoc/giang_vien chua day du de tao phan cong');
  }

  const assignments = buildAssignments(classes, subjects, teachers, mahk);

  if (assignments.length === 0) {
    throw new Error('Khong tao duoc ban ghi phan_cong_giang_day');
  }

  console.log(`[bootstrap] Tao ${assignments.length} ban ghi phan_cong_giang_day`);
  console.log(`[bootstrap] So lop=${classes.length}, mon=${subjects.length}, GV active=${teachers.length}`);

  if (dryRun) {
    console.log('[bootstrap] Dry-run, khong ghi len Supabase');
    return;
  }

  // Xóa TOÀN BỘ bảng trước khi seed để tránh data cũ/trùng lặp
  const { error: deleteError } = await supabase
    .from('phan_cong_giang_day')
    .delete()
    .neq('mapc', '');          // điều kiện luôn đúng → xóa hết
  if (deleteError) throw new Error(deleteError.message);

  const chunkSize = 500;
  for (let i = 0; i < assignments.length; i += chunkSize) {
    const { error } = await supabase
      .from('phan_cong_giang_day')
      .insert(assignments.slice(i, i + chunkSize));
    if (error) throw new Error(error.message);
  }

  const { count, error: countError } = await supabase
    .from('phan_cong_giang_day')
    .select('*', { count: 'exact', head: true });

  if (countError) {
    throw new Error(countError.message);
  }

  console.log(`[bootstrap] Da upsert ${assignments.length} ban ghi.`);
  console.log(`[bootstrap] Tong so ban ghi phan_cong_giang_day hien tai: ${count}`);
}

main().catch((err) => {
  console.error('[bootstrap] Loi:', err.message);
  process.exit(1);
});

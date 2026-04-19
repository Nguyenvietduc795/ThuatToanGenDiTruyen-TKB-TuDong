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
  if (!value) return true;
  return ['active', 'hoatdong', 'available', 'ready', 'sansang', 'ranh', '1', 'true'].includes(value);
}

function chooseTeacher(teachers, classIdx, subjectIdx, type) {
  const offset = type === 'TH' ? 1 : 0;
  const idx = (classIdx + subjectIdx + offset) % teachers.length;
  return teachers[idx];
}

function sessionsForType(totalPeriods, type) {
  const total = Number(totalPeriods || 0);
  if (total <= 0) return null;

  if (type === 'LT') {
    if (total >= 45) return { sobuoimoituan: 2, sotietmoibuoi: 3 };
    return { sobuoimoituan: 1, sotietmoibuoi: 5 };
  }

  return { sobuoimoituan: 1, sotietmoibuoi: 5 };
}

function buildAssignments(classes, subjects, teachers, hocky, namhoc) {
  const assignments = [];
  let seq = 1;

  classes.forEach((lop, classIdx) => {
    subjects.forEach((mon, subjectIdx) => {
      const lt = sessionsForType(mon.sotietlythuyet, 'LT');
      const th = sessionsForType(mon.sotietthuchanh, 'TH');

      for (const item of [
        { type: 'LT', cfg: lt },
        { type: 'TH', cfg: th },
      ]) {
        if (!item.cfg) continue;

        const teacher = chooseTeacher(teachers, classIdx, subjectIdx, item.type);
        const seqText = String(seq).padStart(5, '0');
        assignments.push({
          mapc: `PC${seqText}`,
          hocky,
          namhoc,
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
  const hocky = Number(process.env.SEED_HOCKY || 1);
  const namhoc = String(process.env.SEED_NAMHOC || '2024-2025');

  const [lopRes, monRes, gvRes] = await Promise.all([
    supabase.from('lop').select('malop').order('malop', { ascending: true }),
    supabase.from('mon_hoc').select('mamon,sotietlythuyet,sotietthuchanh').order('mamon', { ascending: true }),
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

  const assignments = buildAssignments(classes, subjects, teachers, hocky, namhoc);

  if (assignments.length === 0) {
    throw new Error('Khong tao duoc ban ghi phan_cong_giang_day');
  }

  console.log(`[bootstrap] Tao ${assignments.length} ban ghi phan_cong_giang_day tu du lieu Supabase`);
  console.log(`[bootstrap] Hoc ky=${hocky}, Nam hoc=${namhoc}`);
  console.log(`[bootstrap] So GV active duoc su dung: ${teachers.length}`);

  if (dryRun) {
    console.log('[bootstrap] Dry-run, khong ghi len Supabase');
    return;
  }

  const allMapc = assignments.map((item) => item.mapc);
  const chunkSize = 500;
  for (let i = 0; i < allMapc.length; i += chunkSize) {
    const chunk = allMapc.slice(i, i + chunkSize);
    const { error: deleteError } = await supabase
      .from('phan_cong_giang_day')
      .delete()
      .in('mapc', chunk);
    if (deleteError) {
      throw new Error(deleteError.message);
    }
  }

  const { error } = await supabase
    .from('phan_cong_giang_day')
    .insert(assignments);

  if (error) {
    throw new Error(error.message);
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

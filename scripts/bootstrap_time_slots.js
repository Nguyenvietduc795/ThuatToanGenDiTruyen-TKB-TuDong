const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const DAYS = [
  { name: 'Monday' },
  { name: 'Tuesday' },
  { name: 'Wednesday' },
  { name: 'Thursday' },
  { name: 'Friday' },
  { name: 'Saturday' },
  { name: 'Sunday' },
];

function buildTimeSlots() {
  const rows = [];
  DAYS.forEach((day, dayIndex) => {
    for (let slot = 1; slot <= 12; slot += 1) {
      rows.push({
        makhung: dayIndex * 12 + slot, // integer: 1-84
        thutrongtuan: day.name,
        tietbatdau: slot,
        tietketthuc: slot,
        buoihoc: slot <= 6 ? 'Sang' : 'Chieu',
        sotiet: 1,
        trangthai: 'active',
      });
    }
  });
  return rows;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const rows = buildTimeSlots();

  console.log(`[bootstrap] Tao ${rows.length} khung_thoi_gian (7 ngay x 12 tiet)`);
  if (dryRun) {
    console.log('[bootstrap] Dry-run, khong ghi len Supabase');
    return;
  }

  const { error } = await supabase
    .from('khung_thoi_gian')
    .upsert(rows, { onConflict: 'makhung' });

  if (error) {
    throw new Error(error.message);
  }

  const { count, error: countError } = await supabase
    .from('khung_thoi_gian')
    .select('*', { count: 'exact', head: true });

  if (countError) {
    throw new Error(countError.message);
  }

  console.log(`[bootstrap] Da upsert ${rows.length} khung.`);
  console.log(`[bootstrap] Tong so khung hien tai: ${count}`);
}

main().catch((err) => {
  console.error('[bootstrap] Loi:', err.message);
  process.exit(1);
});

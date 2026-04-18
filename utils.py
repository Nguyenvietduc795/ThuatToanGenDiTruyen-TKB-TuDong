import json
import math
import os
import random
from datetime import date, timedelta
from costs import (
    check_hard_constraints,
    subjects_order_cost,
    empty_space_groups_cost,
    empty_space_teachers_cost,
    free_hour,
)
from model import Class, Classroom, Data

# ============================================================
# CONSTANTS - cau truc thoi gian
# WHY changed: tu 5 ngay (Mon-Fri) sang 6 ngay (Mon-Sat), tu gio 9-20 sang tiet 1-12
# ============================================================
DAYS_PER_WEEK  = 6   # Thu 2 -> Thu 7 (khong co Chu nhat)
SLOTS_PER_DAY  = 12  # 12 tiet moi ngay
TOTAL_SLOTS    = DAYS_PER_WEEK * SLOTS_PER_DAY  # 72 hang trong matrix
MORNING_SLOTS  = 6   # Tiet 1-6 la buoi sang

DAYS = ['Thu 2', 'Thu 3', 'Thu 4', 'Thu 5', 'Thu 6', 'Thu 7']


def load_data(file_path, teachers_empty_space, groups_empty_space, subjects_order):
    """
    Doc va xu ly du lieu tu file JSON mock (schema Viet hoa).
    WHAT changed: rewrite hoan toan tu format cu (tieng Serbia) sang format moi.

    :param file_path: duong dan toi mock_data.json
    :param teachers_empty_space: dict {magv: [list tiet dang day]} - duoc khoi tao tai day
    :param groups_empty_space:   dict {group_index: [list tiet dang hoc]} - duoc khoi tao tai day
    :param subjects_order:       dict {(mamon, group_idx): {'LT': tiet, 'TH': tiet}}
    :return: Data(groups, teachers, classes, classrooms)
    """
    with open(file_path, encoding='utf-8') as f:
        raw = json.load(f)

    classes    = {}   # index (int) -> Class
    classrooms = {}   # index (int) -> Classroom
    teachers   = {}   # magv (str)  -> index (int)
    groups     = {}   # malop (str) -> index (int)
    class_list = []   # tam thoi luu truoc khi shuffle

    # --- 1. Xay dung danh sach phong hoc (cot trong matrix) ---
    for room in raw['phong_hoc']:
        if room['trangthai'] == 'active':
            idx = len(classrooms)
            classrooms[idx] = Classroom(room['maphong'], room['loaiphong'])

    # --- 2. Xay dung danh sach lop hoc (groups) ---
    for lop in raw['lop']:
        idx = len(groups)
        groups[lop['malop']] = idx
        groups_empty_space[idx] = []   # khoi tao empty space theo doi

    # --- 3. Xay dung danh sach giang vien ---
    for gv in raw['giang_vien']:
        if gv['trangthai'] == 'active':
            teachers[gv['magv']] = len(teachers)
            teachers_empty_space[gv['magv']] = []   # khoi tao empty space theo doi

    # --- 4. Tao cac doi tuong Class tu phan_cong_giang_day ---
    # Moi ban ghi phan_cong voi sobuoimoituan=N se tao ra N doi tuong Class
    # (moi doi tuong = 1 buoi hoc trong tuan)
    for pc in raw['phan_cong_giang_day']:
        # Bo qua cac key comment trong JSON
        if not isinstance(pc, dict) or 'mapc' not in pc:
            continue

        malop         = pc['malop']
        mamon         = pc['mamon']
        magv          = pc['magv']
        loaiphong     = pc['loaiphong']     # 'LT' hoac 'TH' - kieu phong can dung
        sotietmoibuoi = int(pc['sotietmoibuoi'])
        sobuoimoituan = int(pc['sobuoimoituan'])
        mapc          = pc['mapc']

        # Tim cac phong hop le theo loaiphong
        compatible_rooms = [
            idx for idx, room in classrooms.items()
            if room.type == loaiphong
        ]
        if not compatible_rooms:
            raise ValueError(
                f"Khong tim duoc phong loai '{loaiphong}' cho phan cong {mapc}"
            )

        # Index cua lop hoc
        group_idx = groups[malop]

        # Khoi tao subjects_order neu chua co
        # WHY: theo doi thu tu LT truoc TH cua cung 1 mon cho cung 1 lop
        if (mamon, group_idx) not in subjects_order:
            subjects_order[(mamon, group_idx)] = {'LT': -1, 'TH': -1}

        # Tao sobuoimoituan doi tuong Class (moi doi tuong = 1 session/tuan)
        for _ in range(sobuoimoituan):
            new_class = Class(
                groups=[group_idx],
                teacher=magv,
                subject=mamon,
                type=loaiphong,
                duration=sotietmoibuoi,
                classrooms=list(compatible_rooms),  # copy de tranh shared reference
                assignment_id=mapc,
            )
            class_list.append(new_class)

    # Shuffle de giam thien kien ve thu tu (quan trong cho giang vien day nhieu lop)
    random.shuffle(class_list)

    # Gan index chinh thuc
    for cls in class_list:
        classes[len(classes)] = cls

    return Data(groups, teachers, classes, classrooms)


def set_up(num_of_columns):
    """
    Tao matrix thoi khoa bieu rong va danh sach cac o trong.
    WHAT changed: 5 ngay x 12 gio (60 hang) -> 6 ngay x 12 tiet (72 hang)

    :param num_of_columns: so phong hoc (so cot)
    :return: (matrix, free)
        matrix: list 2D kich thuoc TOTAL_SLOTS x num_of_columns, gia tri None
        free:   list cac tuple (hang, cot) con trong
    """
    matrix = [[None] * num_of_columns for _ in range(TOTAL_SLOTS)]
    free   = [(row, col)
              for row in range(TOTAL_SLOTS)
              for col in range(num_of_columns)]
    return matrix, free


def show_timetable(matrix):
    """
    In thoi khoa bieu ra man hinh.
    Format: hang = (Ngay + Tiet), cot = Phong hoc
    WHAT changed: doi 'Monday 9h' -> 'Thu 2  Tiet 1', bo Sunday, them phan cach buoi
    """
    n_rooms = len(matrix[0]) if matrix else 0

    # In header cot (phong hoc)
    print(f"\n{'':18}", end='')
    for col in range(n_rooms):
        print(f'P{col:<7}', end='')
    print()
    print('-' * (18 + n_rooms * 8))

    prev_day = -1
    for row in range(len(matrix)):
        day_idx  = row // SLOTS_PER_DAY
        slot_idx = row % SLOTS_PER_DAY
        slot_num = slot_idx + 1   # 1-indexed

        # In dong phan cach khi sang ngay moi
        if day_idx != prev_day:
            if prev_day != -1:
                print()
            prev_day = day_idx

        # Nhan buoi hoc
        session = 'S' if slot_num <= MORNING_SLOTS else 'C'  # Sang / Chieu
        label = f'{DAYS[day_idx]} T{slot_num}({session})'
        print(f'{label:18}', end='')

        for col in range(n_rooms):
            cell = matrix[row][col]
            print(f'{str(cell):<8}', end='')
        print()

    print()


def write_solution_to_file(matrix, data, filled, filepath,
                           groups_empty_space, teachers_empty_space, subjects_order):
    """
    Ghi ket qua thoi khoa bieu va thong ke ra file.
    WHAT changed: format thoi gian tu gio sang tiet, them thong tin buoi sang/chieu
    """
    out_path = 'solution_files/sol_' + filepath
    f = open(out_path, 'w', encoding='utf-8')

    # ---------- THONG KE TONG HOP ----------
    f.write('==================== THONG KE ====================\n')

    hard_cost = check_hard_constraints(matrix, data)
    if hard_cost == 0:
        f.write('\nRang buoc cung: THOA MAN 100%\n')
    else:
        f.write(f'Rang buoc cung: VI PHAM, cost = {hard_cost}\n')

    order_pct = subjects_order_cost(subjects_order)
    f.write(f'Thu tu LT truoc TH: {order_pct:.2f}%\n\n')

    eg, meg, avg_eg = empty_space_groups_cost(groups_empty_space)
    f.write(f'Tiet trong (lop)    - Tong: {eg} | Max/ngay: {meg} | TB/tuan: {avg_eg:.2f}\n')

    et, met, avg_et = empty_space_teachers_cost(teachers_empty_space)
    f.write(f'Tiet trong (GV)     - Tong: {et} | Max/ngay: {met} | TB/tuan: {avg_et:.2f}\n')

    fh = free_hour(matrix)
    if fh != -1:
        f.write(f'Tiet trong toan truong: {fh}\n')
    else:
        f.write('Khong co tiet nao trong toan truong.\n')

    # ---------- LICH TIET KY CHI TIET ----------
    # Xay dung mapping index -> ten lop
    groups_by_idx = {idx: name for name, idx in data.groups.items()}

    f.write('\n==================== LICH TIET KY ====================\n')

    for class_idx, time_fields in filled.items():
        c = data.classes[class_idx]

        group_names = ', '.join(groups_by_idx.get(g, str(g)) for g in c.groups)
        room_obj    = data.classrooms[time_fields[0][1]]
        first_row   = time_fields[0][0]
        day_idx     = first_row // SLOTS_PER_DAY
        start_slot  = first_row % SLOTS_PER_DAY + 1     # 1-indexed
        end_slot    = start_slot + c.duration - 1

        session = 'Sang' if start_slot <= MORNING_SLOTS else 'Chieu'

        f.write(f'\n[Buoi {class_idx}]\n')
        f.write(f'  Mon     : {c.subject} ({c.type})\n')
        f.write(f'  GV      : {c.teacher}\n')
        f.write(f'  Lop     : {group_names}\n')
        f.write(f'  Phong   : {room_obj.name} (loai {room_obj.type})\n')
        f.write(f'  Thoi gian: {DAYS[day_idx]} | Tiet {start_slot}-{end_slot} ({session})\n')

    f.close()
    print(f'Da ghi ket qua ra: {out_path}')

    # Tao them file viewer HTML
    write_viewer_html(filled, data, filepath)


# ============================================================
# VIEWER HTML EXPORT
# ============================================================

def write_viewer_html(filled, data, filepath):
    """
    Tao file HTML de xem TKB theo 3 goc do: Quan ly / Giang vien / Sinh vien.
    File duoc ghi vao: solution_files/sol_<name>_viewer.html
    Mo bang trinh duyet la xem duoc ngay, khong can server.
    """
    # Doc du lieu goc de lay ten day du
    with open('test_files/' + filepath, encoding='utf-8') as f:
        raw = json.load(f)

    gv_map    = {gv['magv']: {'tengv': gv['tengv'], 'hocvi': gv['hocvi']}
                 for gv in raw['giang_vien']}
    lop_map   = {l['malop']: l['tenlop'] for l in raw['lop']}
    mon_map   = {m['mamon']: m['tenmon'] for m in raw['mon_hoc']}
    phong_map = {p['maphong']: p['tenphong'] for p in raw['phong_hoc']}
    groups_by_idx = {idx: malop for malop, idx in data.groups.items()}

    # Lookup để tính last_week
    pc_lookup  = {pc['mapc']: pc for pc in raw['phan_cong_giang_day']}
    mon_detail = {m['mamon']: m  for m in raw['mon_hoc']}

    def calc_last_week(cls):
        """Tuần cuối cùng học phần còn xuất hiện trên lịch."""
        pc = pc_lookup.get(cls.assignment_id, {})
        sobuoi    = int(pc.get('sobuoimoituan', 1))
        tiets_pw  = sobuoi * int(cls.duration)   # tiết/tuần cho loại này
        mon       = mon_detail.get(cls.subject, {})
        field     = 'sotietlythuyet' if cls.type == 'LT' else 'sotietthuchanh'
        total     = int(mon.get(field, tiets_pw))
        return math.ceil(total / tiets_pw) if tiets_pw > 0 else 1

    # Xay dung danh sach lich
    lich = []
    for class_idx, time_fields in filled.items():
        c         = data.classes[class_idx]
        first_row = time_fields[0][0]
        col       = time_fields[0][1]
        day_idx   = first_row // SLOTS_PER_DAY
        start_s   = first_row % SLOTS_PER_DAY + 1
        end_s     = start_s + int(c.duration) - 1
        room_obj  = data.classrooms[col]
        malop     = groups_by_idx.get(c.groups[0], '?') if c.groups else '?'

        lich.append({
            'mamon'     : c.subject,
            'tenmon'    : mon_map.get(c.subject, c.subject),
            'loai'      : c.type,
            'magv'      : c.teacher,
            'tengv'     : gv_map.get(c.teacher, {}).get('tengv', c.teacher),
            'hocvi'     : gv_map.get(c.teacher, {}).get('hocvi', ''),
            'malop'     : malop,
            'tenlop'    : lop_map.get(malop, malop),
            'maphong'   : room_obj.name,
            'tenphong'  : phong_map.get(room_obj.name, room_obj.name),
            'thu_idx'   : day_idx,
            'tiet_start': start_s,
            'tiet_end'  : end_s,
            'last_week' : calc_last_week(c),
        })

    today  = date.today()
    monday = today - timedelta(days=today.weekday())   # thứ 2 của tuần hiện tại

    data_js = json.dumps({
        'lich'      : lich,
        'gv_list'   : [{'magv': k, **v} for k, v in gv_map.items()],
        'lop_list'  : [{'malop': k, 'tenlop': v} for k, v in lop_map.items()],
        'phong_list': [{'maphong': p['maphong'],
                        'tenphong': p['tenphong'],
                        'loaiphong': p['loaiphong']}
                       for p in raw['phong_hoc']
                       if p.get('trangthai') == 'active'],
        'mon_list'  : [{'mamon': m['mamon'],
                        'sotietlythuyet': m.get('sotietlythuyet', 0),
                        'sotietthuchanh': m.get('sotietthuchanh', 0)}
                       for m in raw['mon_hoc']],
        'start_date': monday.isoformat(),   # "YYYY-MM-DD" — tuần 1 bắt đầu từ đây
    }, ensure_ascii=False)

    html_content = _build_viewer_html(data_js)
    out_path = 'solution_files/sol_' + filepath.replace('.json', '_viewer.html')
    with open(out_path, 'w', encoding='utf-8') as hf:
        hf.write(html_content)
    print(f'Da tao viewer  : {out_path}')


def _build_viewer_html(data_js: str) -> str:
    """Tra ve chuoi HTML hoan chinh cua viewer, doc tu viewer_template.html."""
    template_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'viewer_template.html')
    with open(template_path, encoding='utf-8') as f:
        html = f.read()
    return html.replace('__DATA_PLACEHOLDER__', data_js)


def _build_viewer_html_OLD(data_js: str) -> str:
    """[DEPRECATED] Tra ve chuoi HTML hoan chinh cua viewer, voi du lieu nhung vao __DATA__."""
    html = r'''<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Thời Khóa Biểu — Khoa CNTT</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>
  body { font-family: 'Segoe UI', sans-serif; }
  .timetable { border-collapse: collapse; width: 100%; table-layout: fixed; }
  .timetable th { border: 1px solid #d1d5db; background: #f3f4f6; padding: 8px 4px;
                  text-align: center; font-size: 13px; font-weight: 600; }
  .timetable td { border: 1px solid #e5e7eb; }
  .tiet-lbl  { width: 38px; text-align: center; font-size: 11px; color: #6b7280;
               background: #f9fafb; padding: 2px; }
  .empty-td  { background: #fafafa; height: 30px; }
  .sess-cell { vertical-align: top; padding: 3px; }
  .sess-card { border-radius: 7px; padding: 5px 7px; height: 100%; }
  .sess-name { font-weight: 700; font-size: 12px; line-height: 1.3; margin-bottom: 3px; }
  .sess-info { color: #374151; font-size: 10.5px; overflow: hidden;
               text-overflow: ellipsis; white-space: nowrap; margin-top: 1px; }
  .badge     { display:inline-block; padding:1px 5px; border-radius:4px;
               font-size:9px; font-weight:700; margin-bottom:3px; }
  .bdg-lt    { background:#dbeafe; color:#1d4ed8; }
  .bdg-th    { background:#dcfce7; color:#15803d; }
  .sang-hd td { background:#fffbeb; text-align:center; font-size:11px;
                font-weight:700; color:#92400e; padding:5px; }
  .chieu-hd td{ background:#eff6ff; text-align:center; font-size:11px;
                font-weight:700; color:#1e40af; padding:5px; }
  .c-M01{background:#eff6ff;border-left:3px solid #3b82f6}
  .c-M02{background:#f0fdf4;border-left:3px solid #22c55e}
  .c-M03{background:#faf5ff;border-left:3px solid #a855f7}
  .c-M04{background:#fff7ed;border-left:3px solid #f97316}
  .c-M05{background:#fef2f2;border-left:3px solid #ef4444}
  .c-M06{background:#fefce8;border-left:3px solid #eab308}
  .c-M07{background:#f0fdfa;border-left:3px solid #14b8a6}
  .c-M08{background:#fdf4ff;border-left:3px solid #d946ef}
  .c-def{background:#f9fafb;border-left:3px solid #9ca3af}
  .tab-on { background:#1d4ed8 !important; color:#fff !important; }
</style>
</head>
<body class="bg-gray-100 min-h-screen">
<div class="max-w-screen-xl mx-auto p-4">

  <!-- Header -->
  <div class="bg-gradient-to-r from-blue-700 to-indigo-600 text-white rounded-2xl p-5 mb-5 shadow-lg flex items-center gap-4">
    <div class="text-5xl">📅</div>
    <div>
      <h1 class="text-2xl font-bold tracking-tight">Thời Khóa Biểu</h1>
      <p class="text-blue-200 text-sm mt-0.5">Khoa Công nghệ Thông tin — Học kỳ 1 / 2024–2025</p>
    </div>
  </div>

  <!-- Tabs -->
  <div class="flex gap-2 mb-5">
    <button id="btn-ql" onclick="switchTab('ql')"
      class="px-5 py-2.5 rounded-xl font-semibold text-sm shadow bg-white text-gray-600 transition-all">
      🏫 Quản lý
    </button>
    <button id="btn-gv" onclick="switchTab('gv')"
      class="px-5 py-2.5 rounded-xl font-semibold text-sm shadow bg-white text-gray-600 transition-all">
      👨‍🏫 Giảng viên
    </button>
    <button id="btn-sv" onclick="switchTab('sv')"
      class="px-5 py-2.5 rounded-xl font-semibold text-sm shadow bg-white text-gray-600 transition-all">
      🎓 Sinh viên
    </button>
  </div>

  <!-- ===== TAB: Quản lý ===== -->
  <div id="tab-ql" class="tab-pane">
    <div id="stats-row" class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4"></div>
    <div id="legend-row" class="flex flex-wrap gap-2 mb-4 bg-white rounded-xl p-3 shadow text-xs"></div>
    <div class="bg-white rounded-2xl shadow p-4 overflow-x-auto">
      <p class="text-xs text-gray-400 mb-3">
        Mỗi ô hiển thị buổi học tại tiết bắt đầu. Tiết kết thúc ghi trong thẻ.
        Nhiều buổi cùng slot = các lớp khác nhau học song song.
      </p>
      <div id="grid-ql"></div>
    </div>
  </div>

  <!-- ===== TAB: Giảng viên ===== -->
  <div id="tab-gv" class="tab-pane hidden">
    <div class="bg-white rounded-2xl shadow p-4 mb-4 flex flex-wrap items-center gap-3">
      <span class="text-sm font-semibold text-gray-700">👨‍🏫 Chọn giảng viên:</span>
      <select id="sel-gv" onchange="renderGV()"
        class="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 min-w-52">
      </select>
      <span id="gv-info" class="text-xs text-gray-500 italic"></span>
    </div>
    <div class="bg-white rounded-2xl shadow p-4 overflow-x-auto">
      <div id="grid-gv"></div>
    </div>
  </div>

  <!-- ===== TAB: Sinh viên ===== -->
  <div id="tab-sv" class="tab-pane hidden">
    <div class="bg-white rounded-2xl shadow p-4 mb-4 flex flex-wrap items-center gap-3">
      <span class="text-sm font-semibold text-gray-700">🎓 Chọn lớp:</span>
      <select id="sel-lop" onchange="renderSV()"
        class="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 min-w-52">
      </select>
    </div>
    <div class="bg-white rounded-2xl shadow p-4 overflow-x-auto">
      <div id="grid-sv"></div>
    </div>
  </div>

</div><!-- /container -->

<script>
const DATA = __DATA_PLACEHOLDER__;
const DAYS = ['Thứ 2','Thứ 3','Thứ 4','Thứ 5','Thứ 6','Thứ 7'];
const CLR  = {M01:'c-M01',M02:'c-M02',M03:'c-M03',M04:'c-M04',
               M05:'c-M05',M06:'c-M06',M07:'c-M07',M08:'c-M08'};

function clr(m){ return CLR[m]||'c-def'; }

/* ---- Tab ---- */
function switchTab(tab){
  document.querySelectorAll('.tab-pane').forEach(e=>e.classList.add('hidden'));
  document.querySelectorAll('[id^=btn-]').forEach(e=>{
    e.classList.remove('tab-on');
    e.classList.add('bg-white','text-gray-600');
  });
  document.getElementById('tab-'+tab).classList.remove('hidden');
  const b = document.getElementById('btn-'+tab);
  b.classList.add('tab-on');
  b.classList.remove('bg-white','text-gray-600');
}

/* ---- Session card HTML ---- */
function card(s, showGV, showLop, compact){
  const badge    = `<span class="badge ${s.loai==='TH'?'bdg-th':'bdg-lt'}">${s.loai}</span>`;
  const tietLine = compact
    ? `<div class="sess-info" style="font-size:9px;color:#9ca3af">Tiết ${s.tiet_start}–${s.tiet_end}</div>` : '';
  const gvLine   = showGV  ? `<div class="sess-info">👤 ${s.tengv}</div>` : '';
  const lopLine  = showLop ? `<div class="sess-info">🎓 ${s.tenlop}</div>` : '';
  const mb       = compact ? 'margin-bottom:3px;' : '';
  return `<div class="sess-card ${clr(s.mamon)}" style="${mb}">
    <div class="sess-name">${s.tenmon}</div>
    ${badge}${tietLine}${gvLine}${lopLine}
    <div class="sess-info">🏛 ${s.maphong}</div>
  </div>`;
}

/* ---- Grid with rowspan (GV / SV — at most 1 session per slot per day) ---- */
function buildGrid(sessions, showGV, showLop){
  const g = {};
  sessions.forEach(s=>{
    if(!g[s.thu_idx]) g[s.thu_idx]={};
    g[s.thu_idx][s.tiet_start] = s;
  });
  const rowEnd = new Array(6).fill(0);
  let h = '<table class="timetable"><thead><tr><th style="width:38px">Tiết</th>';
  DAYS.forEach(d=> h+=`<th>${d}</th>`);
  h += '</tr></thead><tbody>';
  for(let t=1;t<=12;t++){
    if(t===1) h+='<tr class="sang-hd"><td colspan="7">☀️ BUỔI SÁNG &nbsp;(Tiết 1 – 6)</td></tr>';
    if(t===7) h+='<tr class="chieu-hd"><td colspan="7">🌙 BUỔI CHIỀU &nbsp;(Tiết 7 – 12)</td></tr>';
    h+='<tr>';
    h+=`<td class="tiet-lbl">${t}</td>`;
    for(let d=0;d<6;d++){
      if(rowEnd[d]>t) continue;
      const s = g[d]&&g[d][t];
      if(s){
        const sp = s.tiet_end - s.tiet_start + 1;
        rowEnd[d] = t + sp;
        h+=`<td rowspan="${sp}" class="sess-cell">${card(s,showGV,showLop,false)}</td>`;
      } else {
        h+='<td class="empty-td"></td>';
      }
    }
    h+='</tr>';
  }
  return h+'</tbody></table>';
}

/* ---- Management grid (multiple sessions per start-tiết) ---- */
function buildGridAll(sessions){
  const g={};
  sessions.forEach(s=>{
    if(!g[s.thu_idx]) g[s.thu_idx]={};
    if(!g[s.thu_idx][s.tiet_start]) g[s.thu_idx][s.tiet_start]=[];
    g[s.thu_idx][s.tiet_start].push(s);
  });
  const tiets = [...new Set(sessions.map(s=>s.tiet_start))].sort((a,b)=>a-b);
  let h='<table class="timetable"><thead><tr><th style="width:55px">Tiết BĐ</th>';
  DAYS.forEach(d=> h+=`<th>${d}</th>`);
  h+='</tr></thead><tbody>';
  let prev=null;
  tiets.forEach(t=>{
    const buoi = t<=6?'sang':'chieu';
    if(buoi!==prev){
      prev=buoi;
      h += buoi==='sang'
        ? '<tr class="sang-hd"><td colspan="7">☀️ BUỔI SÁNG</td></tr>'
        : '<tr class="chieu-hd"><td colspan="7">🌙 BUỔI CHIỀU</td></tr>';
    }
    h+='<tr>';
    h+=`<td class="tiet-lbl" style="font-size:10px">Tiết<br><b>${t}</b></td>`;
    for(let d=0;d<6;d++){
      const list=(g[d]&&g[d][t])||[];
      if(!list.length){ h+='<td class="empty-td"></td>'; continue; }
      h+='<td class="sess-cell" style="min-width:140px">';
      list.forEach(s=> h+=card(s,true,true,true));
      h+='</td>';
    }
    h+='</tr>';
  });
  return h+'</tbody></table>';
}

/* ---- Stats cards ---- */
function buildStats(){
  const L=DATA.lich;
  const info=[
    {icon:'📅',val:L.length,          lbl:'Tổng buổi học', bg:'bg-blue-50',  bd:'border-blue-200', tx:'text-blue-700'},
    {icon:'👨‍🏫',val:new Set(L.map(s=>s.magv)).size,  lbl:'Giảng viên',   bg:'bg-green-50', bd:'border-green-200',tx:'text-green-700'},
    {icon:'🎓',val:new Set(L.map(s=>s.malop)).size, lbl:'Lớp học',      bg:'bg-purple-50',bd:'border-purple-200',tx:'text-purple-700'},
    {icon:'🏛',val:new Set(L.map(s=>s.maphong)).size,lbl:'Phòng dùng',   bg:'bg-orange-50',bd:'border-orange-200',tx:'text-orange-700'},
  ];
  return info.map(i=>`
    <div class="rounded-2xl shadow border p-4 ${i.bg} ${i.bd}">
      <div class="text-3xl">${i.icon}</div>
      <div class="text-3xl font-bold ${i.tx} mt-1">${i.val}</div>
      <div class="text-sm ${i.tx} font-medium mt-1">${i.lbl}</div>
    </div>`).join('');
}

/* ---- Legend ---- */
function buildLegend(){
  const ms={};
  DATA.lich.forEach(s=>{ ms[s.mamon]=s.tenmon; });
  return '<span class="text-gray-400 mr-1 self-center">Màu:</span>'
    + Object.entries(ms).map(([m,n])=>
        `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-medium ${clr(m)}">${m}: ${n}</span>`
      ).join('');
}

/* ---- Init ---- */
function init(){
  document.getElementById('stats-row').innerHTML  = buildStats();
  document.getElementById('legend-row').innerHTML = buildLegend();
  document.getElementById('grid-ql').innerHTML    = buildGridAll(DATA.lich);

  const sgv = document.getElementById('sel-gv');
  DATA.gv_list.forEach(g=>{
    const o=document.createElement('option');
    o.value=g.magv; o.textContent=`${g.tengv} (${g.hocvi})`; sgv.appendChild(o);
  });

  const slop = document.getElementById('sel-lop');
  DATA.lop_list.forEach(l=>{
    const o=document.createElement('option');
    o.value=l.malop; o.textContent=l.tenlop; slop.appendChild(o);
  });

  renderGV(); renderSV(); switchTab('ql');
}

function renderGV(){
  const id = document.getElementById('sel-gv').value;
  const gv = DATA.gv_list.find(g=>g.magv===id)||{};
  document.getElementById('gv-info').textContent = gv.hocvi||'';
  const ses = DATA.lich.filter(s=>s.magv===id);
  document.getElementById('grid-gv').innerHTML = ses.length
    ? buildGrid(ses, false, true)
    : '<p class="text-gray-400 text-sm py-10 text-center">Không có lịch dạy trong tuần này.</p>';
}

function renderSV(){
  const id = document.getElementById('sel-lop').value;
  const ses = DATA.lich.filter(s=>s.malop===id);
  document.getElementById('grid-sv').innerHTML = ses.length
    ? buildGrid(ses, true, false)
    : '<p class="text-gray-400 text-sm py-10 text-center">Không có lịch học trong tuần này.</p>';
}

window.onload = init;
</script>
</body>
</html>'''
    return html.replace('__DATA_PLACEHOLDER__', data_js)
# END _build_viewer_html_OLD

def show_statistics(matrix, data, subjects_order, groups_empty_space, teachers_empty_space):
    """
    In thong ke ket qua ra man hinh.
    """
    print('\n---------- THONG KE ----------')

    hard_cost = check_hard_constraints(matrix, data)
    if hard_cost == 0:
        print('Rang buoc cung   : THOA MAN 100%')
    else:
        print(f'Rang buoc cung   : VI PHAM, cost = {hard_cost}')

    order_pct = subjects_order_cost(subjects_order)
    print(f'Thu tu LT -> TH  : {order_pct:.2f}%')

    eg, meg, avg_eg = empty_space_groups_cost(groups_empty_space)
    print(f'Tiet trong (lop) : tong={eg} | max/ngay={meg} | tb/tuan={avg_eg:.2f}')

    et, met, avg_et = empty_space_teachers_cost(teachers_empty_space)
    print(f'Tiet trong (GV)  : tong={et} | max/ngay={met} | tb/tuan={avg_et:.2f}')

    fh = free_hour(matrix)
    if fh != -1:
        print(f'Tiet trong toan truong: {fh}')
    else:
        print('Khong co tiet nao trong toan truong.')
    print('------------------------------\n')

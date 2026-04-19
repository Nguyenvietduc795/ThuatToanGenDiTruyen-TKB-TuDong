# ============================================================
# CONSTANTS - dong bo voi utils.py
# WHY: tap trung hang so o day de khi doi chi sua 1 cho
# ============================================================
DAYS_PER_WEEK = 6   # Thu 2 -> Thu 7
SLOTS_PER_DAY = 12  # 12 tiet moi ngay
TOTAL_SLOTS   = DAYS_PER_WEEK * SLOTS_PER_DAY  # 72

MORNING_SLOTS = 6   # Tiet 1-6: buoi sang; Tiet 7-12: buoi chieu
DAYS = ['Thu 2', 'Thu 3', 'Thu 4', 'Thu 5', 'Thu 6', 'Thu 7']

# Trong so de tinh tong fitness (cost minimization)
# Hard constraint vi pham NANG hon soft 100 lan
HARD_WEIGHT = 100


# ============================================================
# HARD CONSTRAINTS
# ============================================================

def _teacher_conflicts(matrix, data):
    """
    HARD - Mot giang vien khong duoc day 2 lop cung 1 tiet.
    Duyet tung hang (1 tiet), kiem tra tung cap o co cung giang vien.
    Tra ve: (cost_total, cost_per_class_dict)
    """
    cost = 0
    cost_per_class = {idx: 0 for idx in data.classes}

    for row in range(len(matrix)):
        # Thu thap tat ca buoi hoc trong cung tiet nay
        occupied = [(col, matrix[row][col])
                    for col in range(len(matrix[row]))
                    if matrix[row][col] is not None]

        # So sanh tung cap
        for i in range(len(occupied)):
            col_i, idx_i = occupied[i]
            c_i = data.classes[idx_i]
            for j in range(i + 1, len(occupied)):
                col_j, idx_j = occupied[j]
                c_j = data.classes[idx_j]
                if c_i.teacher == c_j.teacher:
                    cost += 1
                    cost_per_class[idx_i] += 1
                    cost_per_class[idx_j] += 1

    return cost, cost_per_class


def _group_conflicts(matrix, data):
    """
    HARD - Mot lop khong duoc hoc 2 mon cung 1 tiet.
    Tra ve: (cost_total, cost_per_class_dict)
    """
    cost = 0
    cost_per_class = {idx: 0 for idx in data.classes}

    for row in range(len(matrix)):
        occupied = [(col, matrix[row][col])
                    for col in range(len(matrix[row]))
                    if matrix[row][col] is not None]

        for i in range(len(occupied)):
            col_i, idx_i = occupied[i]
            c_i = data.classes[idx_i]
            for j in range(i + 1, len(occupied)):
                col_j, idx_j = occupied[j]
                c_j = data.classes[idx_j]
                # Kiem tra xem 2 buoi hoc co chung lop nao khong
                for g in c_i.groups:
                    if g in c_j.groups:
                        cost += 1
                        cost_per_class[idx_i] += 1
                        cost_per_class[idx_j] += 1

    return cost, cost_per_class


def _classroom_type_mismatch(matrix, data):
    """
    HARD - Mon hoc phai duoc xep dung loai phong.
    Vi du: mon thuc hanh (TH) phai vao phong may tinh (loaiphong='TH').
    Tra ve: (cost_total, cost_per_class_dict)
    """
    cost = 0
    cost_per_class = {idx: 0 for idx in data.classes}

    for row in range(len(matrix)):
        for col in range(len(matrix[row])):
            idx = matrix[row][col]
            if idx is not None:
                cls = data.classes[idx]
                # col chinh la index phong -> kiem tra co nam trong danh sach phong hop le khong
                if col not in cls.classrooms:
                    cost += 1
                    cost_per_class[idx] += 1

    return cost, cost_per_class


def _same_assignment_same_day(matrix, data):
    """
    HARD - 2 buoi hoc cua cung phan_cong (mapc) KHONG duoc xep cung ngay.

    Rule: neu sobuoimoituan=2 thi 2 buoi phai nam o 2 NGAY KHAC NHAU.
    Vi pham dien hinh: Mon 3tiet x 2 buoi/tuan bi xep Thu 2 ca 2 → 6 tiet lien tuc.

    SCORING: +1 moi buoi du thua tren cung ngay cua cung mapc.
    Vi du: mapc=PC001 co 2 buoi, ca 2 o Thu 2 → cost += 1.
    """
    cost = 0
    cost_per_class = {idx: 0 for idx in data.classes}

    for day in range(DAYS_PER_WEEK):
        # Thu thap cac class_idx xuat hien trong ngay (chi dem 1 lan moi class)
        seen_class = set()
        mapc_classes = {}   # mapc -> [class_idx, ...]

        for slot_idx in range(SLOTS_PER_DAY):
            row = day * SLOTS_PER_DAY + slot_idx
            for col in range(len(matrix[row])):
                class_idx = matrix[row][col]
                if class_idx is not None and class_idx not in seen_class:
                    seen_class.add(class_idx)
                    asgn_id = data.classes[class_idx].assignment_id
                    if asgn_id:
                        mapc_classes.setdefault(asgn_id, []).append(class_idx)

        # Neu cung 1 mapc xuat hien > 1 lan trong ngay -> vi pham
        for idxs in mapc_classes.values():
            if len(idxs) > 1:
                extra = len(idxs) - 1   # so buoi du thua
                cost += extra
                for idx in idxs:
                    cost_per_class[idx] += extra

    return cost, cost_per_class


def calculate_hard_constraints(matrix, data):
    """
    TINH TONG COST VI PHAM RANG BUOC CUNG.

    INPUT : matrix (TOTAL_SLOTS x n_rooms), data (Data object)
    OUTPUT: (total_cost, details_dict)

    SCORING: Minimization - THAP hon = TOT hon. 0 = khong vi pham.

    Gom 4 loai rang buoc cung:
      1. teacher_conflicts      - GV day 2 lop cung tiet
      2. group_conflicts        - Lop hoc 2 mon cung tiet
      3. classroom_mismatches   - Phong sai loai
      4. same_assignment_day    - 2 buoi cung mapc xep cung ngay (FORBIDDEN)

    details_dict chua:
      - 'cost_per_class'        : {class_idx: int} - de sort khi chon class de dot bien
      - 'teacher_conflicts'     : int
      - 'group_conflicts'       : int
      - 'classroom_mismatches'  : int
      - 'same_assignment_day'   : int
    """
    tc, tc_per = _teacher_conflicts(matrix, data)
    gc, gc_per = _group_conflicts(matrix, data)
    cc, cc_per = _classroom_type_mismatch(matrix, data)
    sa, sa_per = _same_assignment_same_day(matrix, data)

    combined = {
        idx: tc_per.get(idx, 0) + gc_per.get(idx, 0)
             + cc_per.get(idx, 0) + sa_per.get(idx, 0)
        for idx in data.classes
    }

    total = tc + gc + cc + sa
    details = {
        'cost_per_class':      combined,
        'teacher_conflicts':   tc,
        'group_conflicts':     gc,
        'classroom_mismatches': cc,
        'same_assignment_day': sa,
    }
    return total, details


# ============================================================
# SOFT CONSTRAINTS
# ============================================================

def _penalty_empty_slots_groups(groups_empty_space):
    """
    SOFT - Penalty cho so tiet trong GIUA cac buoi hoc cua lop trong cung 1 ngay.
    WHY: Sinh vien khong nen co khoang trong giua cac tiet trong ngay.

    Vi du: Lop A hoc Tiet 1, Tiet 4 trong ngay Thu 2
           -> 2 tiet trong (Tiet 2, Tiet 3) -> penalty += 2

    INPUT : groups_empty_space = {group_idx: [list tiet dang co mat]}
    OUTPUT: (total_penalty, max_trong_1_ngay, trung_binh_penalty_theo_lop)
    """
    total_penalty = 0
    max_per_day   = 0

    for group_idx, times in groups_empty_space.items():
        if len(times) < 2:
            continue
        times_sorted = sorted(times)
        per_day = {d: 0 for d in range(DAYS_PER_WEEK)}

        for i in range(1, len(times_sorted)):
            prev = times_sorted[i - 1]
            curr = times_sorted[i]
            day_prev = prev // SLOTS_PER_DAY
            day_curr = curr // SLOTS_PER_DAY

            # Chi tinh khoang trong neu cung ngay
            if day_prev == day_curr:
                gap = curr - prev - 1  # so tiet trong giua 2 tiet lien tiep
                if gap > 0:
                    per_day[day_prev] += gap
                    total_penalty     += gap

        for v in per_day.values():
            if v > max_per_day:
                max_per_day = v

    n = max(len(groups_empty_space), 1)
    return total_penalty, max_per_day, total_penalty / n


def _penalty_empty_slots_teachers(teachers_empty_space):
    """
    SOFT - Penalty cho so tiet trong GIUA cac buoi day cua giang vien trong cung 1 ngay.
    WHY: Giang vien khong nen phai cho qua nhieu tieng giua cac buoi day.

    INPUT : teachers_empty_space = {magv: [list tiet dang day]}
    OUTPUT: (total_penalty, max_trong_1_ngay, trung_binh_penalty_theo_GV)
    """
    total_penalty = 0
    max_per_day   = 0

    for teacher, times in teachers_empty_space.items():
        if len(times) < 2:
            continue
        times_sorted = sorted(times)
        per_day = {d: 0 for d in range(DAYS_PER_WEEK)}

        for i in range(1, len(times_sorted)):
            prev = times_sorted[i - 1]
            curr = times_sorted[i]
            day_prev = prev // SLOTS_PER_DAY
            day_curr = curr // SLOTS_PER_DAY

            if day_prev == day_curr:
                gap = curr - prev - 1
                if gap > 0:
                    per_day[day_prev] += gap
                    total_penalty     += gap

        for v in per_day.values():
            if v > max_per_day:
                max_per_day = v

    n = max(len(teachers_empty_space), 1)
    return total_penalty, max_per_day, total_penalty / n


def _penalty_session_fragmentation(matrix, data):
    """
    SOFT - Penalty khi lop hoc co mat ca buoi SANG lan buoi CHIEU trong cung 1 ngay.
    WHY: Uu tien lich gon trong 1 buoi (sang hoac chieu) thay vi rai rac ca ngay.
         Moi ngay ma 1 lop bi chia doi sang+chieu = +1 penalty.

    INPUT : matrix, data
    OUTPUT: total_penalty (int)
    """
    penalty = 0

    for day in range(DAYS_PER_WEEK):
        # Kiem tra tung lop co mat buoi sang va/hoac chieu trong ngay nay
        groups_in_morning   = set()
        groups_in_afternoon = set()

        for slot_idx in range(SLOTS_PER_DAY):
            row      = day * SLOTS_PER_DAY + slot_idx
            is_morning = slot_idx < MORNING_SLOTS

            for col in range(len(matrix[row])):
                class_idx = matrix[row][col]
                if class_idx is not None:
                    cls = data.classes[class_idx]
                    for g in cls.groups:
                        if is_morning:
                            groups_in_morning.add(g)
                        else:
                            groups_in_afternoon.add(g)

        # Moi lop phai di hoc ca sang lan chieu = 1 don vi penalty
        fragmented = groups_in_morning & groups_in_afternoon
        penalty += len(fragmented)

    return penalty


def _penalty_same_subject_same_day(matrix, data):
    """
    SOFT - Penalty khi cung 1 lop hoc cung 1 mon HOC NHIEU BUOI TRONG CUNG 1 NGAY.
    WHY: Sinh vien khong nen hoc cung 1 mon 2 lan trong ngay (vi du 2 buoi LT Python cung Thu 2).
         Day la soft constraint - bi vi pham se cong penalty, khong cam hoan toan.

    PENALTY: moi buoi vuot qua 1 = +1 penalty
    Vi du: Mon M01 xuat hien 3 lan cho Lop L01 trong Thu 2 -> penalty += 2

    INPUT : matrix, data
    OUTPUT: total_penalty (int)
    """
    penalty = 0

    for day in range(DAYS_PER_WEEK):
        # Tap hop cac class_idx da dem trong ngay nay (tranh dem nhieu lan voi duration > 1)
        seen_class_ids = set()
        # {(group_idx, mamon): so_lan_xuat_hien}
        subject_count  = {}

        for slot_idx in range(SLOTS_PER_DAY):
            row = day * SLOTS_PER_DAY + slot_idx
            for col in range(len(matrix[row])):
                class_idx = matrix[row][col]
                if class_idx is not None and class_idx not in seen_class_ids:
                    seen_class_ids.add(class_idx)
                    cls = data.classes[class_idx]

                    for g in cls.groups:
                        key = (g, cls.subject)
                        subject_count[key] = subject_count.get(key, 0) + 1

        # Moi buoi du thua (> 1) trong cung ngay = +1 penalty
        for count in subject_count.values():
            if count > 1:
                penalty += (count - 1)

    return penalty


def calculate_soft_constraints(matrix, data, groups_empty_space, teachers_empty_space):
    """
    TINH TONG COST VI PHAM RANG BUOC MEM.

    INPUT : matrix, data, groups_empty_space, teachers_empty_space
    OUTPUT: (total_soft_cost, details_dict)

    SCORING: Minimization - THAP hon = TOT hon.

    Gom 4 loai rang buoc mem:
      1. empty_groups         - Tiet trong cua sinh vien trong ngay
      2. empty_teachers       - Tiet trong cua giang vien trong ngay
      3. fragmentation        - Lop hoc ca sang lan chieu trong cung ngay
      4. same_subject_same_day- Cung mon xuat hien nhieu hon 1 lan trong ngay cho cung lop

    details_dict chua gia tri tung thanh phan de debug/log.
    """
    # Penalty 1: tiet trong giua cac buoi hoc cua sinh vien
    eg, _, avg_eg = _penalty_empty_slots_groups(groups_empty_space)

    # Penalty 2: tiet trong giua cac buoi day cua giang vien
    et, _, avg_et = _penalty_empty_slots_teachers(teachers_empty_space)

    # Penalty 3: lich rai rac sang+chieu cung ngay
    frag = _penalty_session_fragmentation(matrix, data)

    # Penalty 4: cung mon hoc nhieu lan cung ngay cung lop
    same_subj = _penalty_same_subject_same_day(matrix, data)

    # Tong hop (co the dieu chinh trong so o day)
    total = eg + et + frag + same_subj

    details = {
        'empty_groups':          eg,
        'empty_teachers':        et,
        'fragmentation':         frag,
        'same_subject_same_day': same_subj,
    }
    return total, details


def calculate_fitness(matrix, data, groups_empty_space, teachers_empty_space):
    """
    TINH TONG FITNESS (COST) CUA 1 GIAI PHAP.

    INPUT : matrix, data, groups_empty_space, teachers_empty_space
    OUTPUT: (total_fitness, hard_cost, soft_cost, hard_details, soft_details)

    SCORING: Minimization
      - total_fitness = hard_cost * HARD_WEIGHT + soft_cost
      - THAP hon = TOT hon
      - Hard vi pham duoc phat nang hon (nhan HARD_WEIGHT=100)
      - Hard cost = 0 nghia la lich hop le (van de kho da giai quyet)
      - Soft cost = 0 nghia la lich toi uu (van de mem da toi uu)

    LOG:
      - In ra hard cost, soft cost, va tong
    """
    hard_cost,  hard_details = calculate_hard_constraints(matrix, data)
    soft_cost,  soft_details = calculate_soft_constraints(
        matrix, data, groups_empty_space, teachers_empty_space
    )
    total_fitness = hard_cost * HARD_WEIGHT + soft_cost
    return total_fitness, hard_cost, soft_cost, hard_details, soft_details


# ============================================================
# UTILITY / LOG
# ============================================================

def log_fitness(hard_cost, soft_cost, hard_details, soft_details, prefix=''):
    """
    In chi tiet tung thanh phan cost ra man hinh.
    """
    total = hard_cost * HARD_WEIGHT + soft_cost
    print(f'{prefix}[FITNESS] Total={total} | Hard={hard_cost} (x{HARD_WEIGHT}) | Soft={soft_cost}')
    print(f'{prefix}  Hard breakdown: teacher={hard_details["teacher_conflicts"]} | '
          f'group={hard_details["group_conflicts"]} | '
          f'classroom={hard_details["classroom_mismatches"]} | '
          f'same_assign_day={hard_details.get("same_assignment_day", 0)}')
    print(f'{prefix}  Soft breakdown: empty_groups={soft_details["empty_groups"]} | '
          f'empty_teachers={soft_details["empty_teachers"]} | '
          f'fragmentation={soft_details["fragmentation"]} | '
          f'same_subj_day={soft_details["same_subject_same_day"]}')


def free_hour(matrix):
    """
    Kiem tra xem co tiet nao trong TOAN TRUONG (tat ca phong deu trong) khong.
    WHAT changed: tu format 'Monday 9h' sang 'Thu 2 Tiet 1 (Sang)'
    Tra ve: chuoi mo ta neu co, -1 neu khong co.
    """
    for row in range(len(matrix)):
        if all(matrix[row][col] is None for col in range(len(matrix[row]))):
            day_idx  = row // SLOTS_PER_DAY
            slot_num = row % SLOTS_PER_DAY + 1
            session  = 'Sang' if slot_num <= MORNING_SLOTS else 'Chieu'
            return f'{DAYS[day_idx]}: Tiet {slot_num} ({session})'
    return -1


# ============================================================
# COMPATIBILITY WRAPPERS
# WHY: Giu lai interface cu de scheduler.py khong can thay doi nhieu
# ============================================================

def check_hard_constraints(matrix, data):
    """
    Wrapper: tra ve tong so vi pham rang buoc cung (scalar).
    0 = tat ca rang buoc cung duoc thoa man.
    """
    total, _ = calculate_hard_constraints(matrix, data)
    return total


def hard_constraints_cost(matrix, data):
    """
    Wrapper giu lai interface cu cho evolutionary_algorithm().
    Tra ve: (total, cost_per_class, teacher_cost, classroom_cost, group_cost)
    """
    total, details = calculate_hard_constraints(matrix, data)
    return (
        total,
        details['cost_per_class'],
        details['teacher_conflicts'],
        details['classroom_mismatches'],
        details['group_conflicts'],
    )


def subjects_order_cost(subjects_order):
    """
    SOFT - Kiem tra thu tu LT (ly thuyet) phai xay ra TRUOC TH (thuc hanh)
    cho cung mon, cung lop trong tuan.
    WHAT changed: tu format cu [P_time, V_time, L_time] sang {'LT': time, 'TH': time}

    INPUT : subjects_order = {(mamon, group_idx): {'LT': int, 'TH': int}}
            -1 = chua duoc xep tiet
    OUTPUT: phan tram rang buoc duoc thoa man (100.0 = hoan hao)
    """
    correct = 0
    total   = 0

    for (subject, group), times in subjects_order.items():
        lt_time = times.get('LT', -1)
        th_time = times.get('TH', -1)
        # Chi kiem tra khi ca LT va TH deu da duoc xep
        if lt_time != -1 and th_time != -1:
            total += 1
            if lt_time < th_time:   # LT truoc TH = dung thu tu
                correct += 1

    if total == 0:
        return 100.0   # Khong co rang buoc thu tu nao = 100% thoa man
    return 100.0 * correct / total


def empty_space_groups_cost(groups_empty_space):
    """
    Wrapper giu lai interface cu.
    Tra ve: (total, max_per_day, average)
    """
    return _penalty_empty_slots_groups(groups_empty_space)


def empty_space_teachers_cost(teachers_empty_space):
    """
    Wrapper giu lai interface cu.
    Tra ve: (total, max_per_day, average)
    """
    return _penalty_empty_slots_teachers(teachers_empty_space)

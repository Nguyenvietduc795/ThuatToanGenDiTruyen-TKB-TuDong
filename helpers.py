import random

from utils import SLOTS_PER_DAY, MORNING_SLOTS


# ============================================================
# BUOC 1: KHOI TAO LICH BAN DAU (Initial Population)
# ============================================================

def initial_population(data, matrix, free, filled,
                       groups_empty_space, teachers_empty_space, subjects_order):
    """
    Xep tung buoi hoc vao o dau tien HOP LE trong matrix.
    Day la buoc "greedy initialization" - khong dam bao toi uu nhung nhanh.

    Hop le nghia la:
      - Phong hop loai (LT/TH)
      - Buoi hoc khong bi tran qua ngay hom sau
      - Toan bo block tiet lien tiep deu con trong
    """
    for index, classs in data.classes.items():
        ind = 0
        while True:
            start_field = free[ind]
            start_row   = start_field[0]
            end_row     = start_row + int(classs.duration) - 1

            # Dieu kien: khong bi tran sang ngay hom sau
            if start_row % SLOTS_PER_DAY > end_row % SLOTS_PER_DAY:
                ind += 1
                continue

            # Dieu kien: tiet bat dau phai nam trong dai hop le
            slot_in_day = start_row % SLOTS_PER_DAY + 1   # 1-indexed (1-12)
            if slot_in_day not in _get_valid_start_slots(classs):
                ind += 1
                continue

            # Dieu kien: buoi hoc khong duoc vuot ranh gioi sang/chieu
            if not _check_session_boundary(start_row, classs.duration):
                ind += 1
                continue

            # Dieu kien: phong phai hop loai (LT hoac TH)
            if start_field[1] not in classs.classrooms:
                ind += 1
                continue

            # Dieu kien: toan bo block tiet phai con trong
            found = True
            for offset in range(1, int(classs.duration)):
                if (start_row + offset, start_field[1]) not in free:
                    found = False
                    ind += 1
                    break

            if found:
                # Dat buoi hoc vao vi tri nay
                for group_idx in classs.groups:
                    insert_order(subjects_order, classs.subject, group_idx,
                                 classs.type, start_row)
                    for offset in range(int(classs.duration)):
                        groups_empty_space[group_idx].append(start_row + offset)

                for offset in range(int(classs.duration)):
                    row = start_row + offset
                    col = start_field[1]
                    filled.setdefault(index, []).append((row, col))
                    free.remove((row, col))
                    teachers_empty_space[classs.teacher].append(row)

                break   # buoi hoc da duoc xep, sang buoi tiep theo

    # Cap nhat matrix
    for index, fields in filled.items():
        for (row, col) in fields:
            matrix[row][col] = index


def initial_population_random(data, matrix, free, filled,
                               groups_empty_space, teachers_empty_space, subjects_order):
    """
    Xep tung buoi hoc vao vi tri NGAU NHIEN HOP LE trong matrix.
    Thu thap tat ca vi tri hop le roi chon ngau nhien 1 cai.

    Hop le nghia la:
      - Phong hop loai (LT/TH)
      - Buoi hoc khong bi tran qua ngay hom sau
      - Buoi hoc khong vuot ranh gioi sang/chieu
      - Toan bo block tiet lien tiep deu con trong (free)
      - Cung mapc (phan_cong) khong duoc xep 2 buoi cung ngay

    Khong kiem tra xung dot GV/lop - de GA xu ly qua fitness.
    """
    # Theo doi ngay da duoc su dung cho tung mapc
    # mapc_days_used: {assignment_id -> set of day_index}
    mapc_days_used = {}

    for index, classs in data.classes.items():
        free_set = set(free)
        duration = int(classs.duration)

        # Lay tap ngay ma mapc nay da duoc xep
        used_days = mapc_days_used.get(classs.assignment_id, set())

        valid_starts = []
        for start_field in free:
            start_row = start_field[0]
            end_row   = start_row + duration - 1

            if start_row % SLOTS_PER_DAY > end_row % SLOTS_PER_DAY:
                continue

            slot_in_day = start_row % SLOTS_PER_DAY + 1
            if slot_in_day not in _get_valid_start_slots(classs):
                continue

            if not _check_session_boundary(start_row, duration):
                continue

            if start_field[1] not in classs.classrooms:
                continue

            # RANG BUOC: cung mapc khong duoc xep 2 buoi cung ngay
            day_of_slot = start_row // SLOTS_PER_DAY
            if classs.assignment_id and day_of_slot in used_days:
                continue

            fields = [(start_row + offset, start_field[1])
                      for offset in range(duration)]
            if all(f in free_set for f in fields):
                valid_starts.append(fields)

        if not valid_starts:
            continue

        chosen    = random.choice(valid_starts)
        start_row = chosen[0][0]
        day_chosen = start_row // SLOTS_PER_DAY

        # Cap nhat mapc_days_used
        if classs.assignment_id:
            mapc_days_used.setdefault(classs.assignment_id, set()).add(day_chosen)

        for group_idx in classs.groups:
            insert_order(subjects_order, classs.subject, group_idx,
                         classs.type, start_row)
            for (row, col) in chosen:
                groups_empty_space[group_idx].append(row)

        for (row, col) in chosen:
            filled.setdefault(index, []).append((row, col))
            free.remove((row, col))
            matrix[row][col] = index
            teachers_empty_space[classs.teacher].append(row)


def _get_valid_start_slots(classs):
    """
    Tra ve tap cac so tiet (1-indexed) hop le de bat dau buoi hoc.

      duration=5 : chi duoc bat dau tiet 1 (sang: 1-5) hoac tiet 7 (chieu: 7-11).
      duration=3 : bat dau tiet 1, 4, 7 hoac 10.
      Mac dinh   : tiet 1-5 (sang) hoac 7-11 (chieu).
    """
    duration = int(classs.duration)
    if duration == 5:
        return frozenset({1, 7})
    if duration == 3:
        return frozenset({1, 4, 7, 10})
    return frozenset(range(1, 6)) | frozenset(range(7, 12))


def _check_session_boundary(start_row, duration):
    """
    Kiem tra buoi hoc co nam TRONG CUNG buoi sang/chieu khong.
    Sang : slot 0-5  (tiet 1-6)
    Chieu: slot 6-11 (tiet 7-12)
    Tra ve True neu HOP LE.
    """
    start_slot = start_row % SLOTS_PER_DAY
    end_slot   = start_slot + int(duration) - 1
    return (start_slot < MORNING_SLOTS) == (end_slot < MORNING_SLOTS)


def insert_order(subjects_order, subject, group, class_type, start_row):
    """
    Cap nhat tiet bat dau cua buoi hoc vao subjects_order.

    :param class_type: 'LT' hoac 'TH'
    :param start_row:  hang trong matrix (0-indexed)
    """
    if (subject, group) not in subjects_order:
        subjects_order[(subject, group)] = {'LT': -1, 'TH': -1}
    subjects_order[(subject, group)][class_type] = start_row


# ============================================================
# MUTATION: Dich chuyen 1 buoi hoc den vi tri "ly tuong"
# ============================================================

def valid_teacher_group_row(matrix, data, index_class, row):
    """
    Kiem tra xem buoi hoc co the dung o hang 'row' ma khong gay xung dot GV/lop khong.
    Tra ve True neu hop le.
    """
    c1 = data.classes[index_class]
    for col in range(len(matrix[row])):
        if matrix[row][col] is not None:
            c2 = data.classes[matrix[row][col]]
            if c1.teacher == c2.teacher:
                return False
            for g in c2.groups:
                if g in c1.groups:
                    return False
    return True


def _get_mapc_days(filled, data, exclude_idx):
    """
    Tra ve dict {assignment_id -> set(day_index)} cho tat ca buoi hoc
    NGOAI TRU buoi hoc co index exclude_idx.
    Dung de kiem tra rang buoc 'cung mapc khong cung ngay' khi mutation.
    """
    mapc_days = {}
    for idx, fields in filled.items():
        if idx == exclude_idx:
            continue
        asgn = data.classes[idx].assignment_id
        if asgn:
            day = fields[0][0] // SLOTS_PER_DAY
            mapc_days.setdefault(asgn, set()).add(day)
    return mapc_days


def mutate_ideal_spot(matrix, data, ind_class, free, filled,
                      groups_empty_space, teachers_empty_space, subjects_order):
    """
    Tim vi tri moi trong matrix cho buoi hoc 'ind_class' ma COST = 0.
    Neu tim duoc, di chuyen buoi hoc den do.
    Neu khong tim duoc, giu nguyen (return som).
    """
    classs      = data.classes[ind_class]
    old_fields  = filled[ind_class]

    # Lay cac ngay da dung boi cac buoi cung mapc (tru chinh no)
    mapc_days = _get_mapc_days(filled, data, ind_class)
    used_days  = mapc_days.get(classs.assignment_id, set())

    ind = 0
    while ind < len(free):
        start_field = free[ind]
        start_row   = start_field[0]
        end_row     = start_row + int(classs.duration) - 1

        if start_row % SLOTS_PER_DAY > end_row % SLOTS_PER_DAY:
            ind += 1
            continue

        slot_in_day = start_row % SLOTS_PER_DAY + 1
        if slot_in_day not in _get_valid_start_slots(classs):
            ind += 1
            continue

        if not _check_session_boundary(start_row, classs.duration):
            ind += 1
            continue

        if start_field[1] not in classs.classrooms:
            ind += 1
            continue

        # Rang buoc: cung mapc khong duoc cung ngay
        if classs.assignment_id and (start_row // SLOTS_PER_DAY) in used_days:
            ind += 1
            continue

        found = True
        for offset in range(int(classs.duration)):
            field = (start_row + offset, start_field[1])
            if field not in free or not valid_teacher_group_row(matrix, data, ind_class,
                                                                start_row + offset):
                found = False
                ind += 1
                break

        if found:
            # --- Xoa vi tri cu ---
            filled.pop(ind_class, None)
            for (old_row, old_col) in old_fields:
                free.append((old_row, old_col))
                matrix[old_row][old_col] = None
                for g in classs.groups:
                    groups_empty_space[g].remove(old_row)
                teachers_empty_space[classs.teacher].remove(old_row)

            # --- Cap nhat subjects_order ---
            for g in classs.groups:
                insert_order(subjects_order, classs.subject, g, classs.type, start_row)
                for offset in range(int(classs.duration)):
                    groups_empty_space[g].append(start_row + offset)

            # --- Ghi vi tri moi ---
            for offset in range(int(classs.duration)):
                row = start_row + offset
                col = start_field[1]
                filled.setdefault(ind_class, []).append((row, col))
                free.remove((row, col))
                matrix[row][col] = ind_class
                teachers_empty_space[classs.teacher].append(row)

            break

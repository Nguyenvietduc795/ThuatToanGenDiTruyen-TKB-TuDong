import random
import copy
import math
from operator import itemgetter

from utils import (
    load_data, show_timetable, set_up, show_statistics,
    write_solution_to_file, SLOTS_PER_DAY, MORNING_SLOTS,
)
from costs import (
    calculate_hard_constraints,
    calculate_soft_constraints,
    calculate_fitness,
    log_fitness,
)


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
            # WHY: start_row % SLOTS_PER_DAY <= end_row % SLOTS_PER_DAY
            #      neu ngang biet start_row % 12 > end_row % 12 -> bi tran
            if start_row % SLOTS_PER_DAY > end_row % SLOTS_PER_DAY:
                ind += 1
                continue

            # Dieu kien: tiet bat dau phai nam trong dai hop le
            # Mon thuong: tiet 1-5 (sang) hoac 7-11 (chieu)
            # AVCB/AVCN : tiet 1-3
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


def _get_valid_start_slots(classs):
    """
    Tra ve tap cac so tiet (1-indexed) hop le de bat dau buoi hoc.
    Phan loai theo duration (so tiet moi buoi):

      Loai 1 - duration=5 (chuyen nganh / co so nganh):
        Chi duoc bat dau tiet 1 (sang: 1-5) hoac tiet 7 (chieu: 7-11).

      Loai 2 - duration=3 (mon linh hoat: Toan, Giai tich, AVCB/AVCN...):
        Bat dau tiet 1 (block 1-3), 4 (block 4-6), 7 (block 7-9), 10 (block 10-12).

      Mac dinh - duration khac:
        Tiet 1-5 (sang) hoac 7-11 (chieu).
    """
    duration = int(classs.duration)
    if duration == 5:
        return frozenset({1, 7})           # Loai 1: chi sang hoac chieu nguyen buoi
    if duration == 3:
        return frozenset({1, 4, 7, 10})    # Loai 2: 4 block linh hoat trong ngay
    return frozenset(range(1, 6)) | frozenset(range(7, 12))  # mac dinh


def _check_session_boundary(start_row, duration):
    """
    Kiem tra buoi hoc co nam TRONG CUNG buoi sang/chieu khong.
    Sang : slot 0-5  (tiet 1-6)
    Chieu: slot 6-11 (tiet 7-12)

    Voi valid_start_slots da duoc dinh nghia theo tung loai, rang buoc nay
    chu yeu bat cross sang->chieu cho cac truong hop duration la gia tri la.
    Tra ve True neu HOP LE.
    """
    start_slot = start_row % SLOTS_PER_DAY        # 0-indexed
    end_slot   = start_slot + int(duration) - 1
    # Ca hai dau/cuoi phai cung buoi (sang hoac chieu)
    return (start_slot < MORNING_SLOTS) == (end_slot < MORNING_SLOTS)


def insert_order(subjects_order, subject, group, class_type, start_row):
    """
    Cap nhat tiet bat dau cua buoi hoc vao subjects_order.
    WHAT changed: tu format [P, V, L] sang {'LT': row, 'TH': row}

    :param class_type: 'LT' hoac 'TH'
    :param start_row:  hang trong matrix (0-indexed)
    """
    if (subject, group) not in subjects_order:
        subjects_order[(subject, group)] = {'LT': -1, 'TH': -1}
    # Ghi nhan tiet dau tien (neu da co roi thi ghi de - lay session moi nhat)
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


def mutate_ideal_spot(matrix, data, ind_class, free, filled,
                      groups_empty_space, teachers_empty_space, subjects_order):
    """
    Tim vi tri moi trong matrix cho buoi hoc 'ind_class' ma COST = 0.
    Neu tim duoc, di chuyen buoi hoc den do.
    Neu khong tim duoc, giu nguyen (return som).

    Day la toan tu DOT BIEN chinh cua thuat toan.
    """
    classs      = data.classes[ind_class]
    old_fields  = filled[ind_class]

    ind = 0
    while ind < len(free):
        start_field = free[ind]
        start_row   = start_field[0]
        end_row     = start_row + int(classs.duration) - 1

        # Kiem tra tran ngay
        if start_row % SLOTS_PER_DAY > end_row % SLOTS_PER_DAY:
            ind += 1
            continue

        # Kiem tra tiet bat dau hop le (khong bat dau tai tiet 6 hoac 12)
        slot_in_day = start_row % SLOTS_PER_DAY + 1   # 1-indexed
        if slot_in_day not in _get_valid_start_slots(classs):
            ind += 1
            continue

        # Kiem tra khong vuot ranh gioi sang/chieu
        if not _check_session_boundary(start_row, classs.duration):
            ind += 1
            continue

        # Kiem tra loai phong
        if start_field[1] not in classs.classrooms:
            ind += 1
            continue

        # Kiem tra toan bo block va xung dot GV/lop
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


def exchange_two(matrix, filled, ind1, ind2):
    """
    Hoan doi vi tri 2 buoi hoc co cung duration trong matrix.
    (Ham nay duoc giu lai, hien tai it duoc su dung trong thuat toan chinh)
    """
    fields1 = filled[ind1]
    fields2 = filled[ind2]
    filled.pop(ind1, None)
    filled.pop(ind2, None)

    for i in range(len(fields1)):
        r1, c1 = fields1[i]
        r2, c2 = fields2[i]
        matrix[r1][c1], matrix[r2][c2] = matrix[r2][c2], matrix[r1][c1]

    filled[ind1] = fields2
    filled[ind2] = fields1
    return matrix


# ============================================================
# BUOC 2: TOI UU RANG BUOC CUNG (Evolutionary Algorithm)
# ============================================================

def evolutionary_algorithm(matrix, data, free, filled,
                            groups_empty_space, teachers_empty_space, subjects_order):
    """
    Thuat toan tien hoa (1+1)-ES de GIAI QUYET RANG BUOC CUNG.
    Muc tieu: dua hard_cost ve 0 (khong con vi pham).

    Chien luoc:
      - Moi vong: sort cac buoi hoc theo cost giam dan
      - Chon 25% buoi toi nhat, thu dot bien moi buoi den vi tri khong xung dot
      - Dung neu: cost = 0 HOAC stagnation >= max_stagnation
      - Dieu chinh sigma (xac suat dot bien) theo quy tac Stifel
    """
    n              = 3
    sigma          = 2.0
    run_times      = 5
    max_stagnation = 200

    for run in range(run_times):
        print(f'\n=== Run {run + 1}/{run_times} | sigma={sigma:.4f} ===')

        t           = 0
        stagnation  = 0
        improve_cnt = 0

        while stagnation < max_stagnation:

            # Tinh cost hien tai
            loss_before, details_before = calculate_hard_constraints(matrix, data)
            cost_classes = details_before['cost_per_class']

            # Kiem tra dieu kien dung
            if loss_before == 0:
                print(f'  [OK] Tim duoc lich hop le! (Iteration {t})')
                show_timetable(matrix)
                return

            # Sort buoi hoc theo cost giam dan
            costs_list = sorted(cost_classes.items(), key=itemgetter(1), reverse=True)

            # Dot bien 25% buoi toi nhat
            for i in range(len(costs_list) // 4):
                class_idx, class_cost = costs_list[i]
                if class_cost > 0 and random.uniform(0, 1) < sigma:
                    mutate_ideal_spot(matrix, data, class_idx, free, filled,
                                      groups_empty_space, teachers_empty_space, subjects_order)

            loss_after, _ = calculate_hard_constraints(matrix, data)

            if loss_after < loss_before:
                stagnation  = 0
                improve_cnt += 1
            else:
                stagnation += 1

            t += 1

            # Quy tac Stifel: dieu chinh sigma moi 10*n vong
            if t >= 10 * n and t % n == 0:
                if improve_cnt < 2 * n:
                    sigma *= 0.85
                else:
                    sigma /= 0.85
                improve_cnt = 0

        # Log cuoi moi run
        _, details_final = calculate_hard_constraints(matrix, data)
        print(f'  Ket thuc run {run + 1} | iterations={t} | hard_cost={loss_after}')
        print(f'  teacher={details_final["teacher_conflicts"]} | '
              f'group={details_final["group_conflicts"]} | '
              f'classroom={details_final["classroom_mismatches"]}')


# ============================================================
# BUOC 3: TOI UU RANG BUOC MEM (Simulated Annealing / Hardening)
# ============================================================

def simulated_hardening(matrix, data, free, filled,
                        groups_empty_space, teachers_empty_space, subjects_order, file):
    """
    Simulated Annealing de TOI UU RANG BUOC MEM (sau khi hard da duoc giai quyet).
    Muc tieu: giam so tiet trong, han che lich rai rac, han che cung mon cung ngay.

    Nhiet do giam dan theo hang so nhan (geometric cooling): T *= 0.99
    Chap nhan giai phap xau hon voi xac suat exp((curr-new)/T) de tranh cuc tieu dia phuong.
    """
    iter_count = 2500
    T          = 0.5

    # Tinh soft cost ban dau
    curr_soft, curr_soft_details = calculate_soft_constraints(
        matrix, data, groups_empty_space, teachers_empty_space
    )
    curr_cost = curr_soft

    print(f'\n=== SIMULATED ANNEALING ===')
    print(f'Soft cost ban dau: {curr_cost}')
    log_fitness(0, curr_cost,
                {'teacher_conflicts': 0, 'group_conflicts': 0, 'classroom_mismatches': 0},
                curr_soft_details, prefix='  ')

    for i in range(iter_count):
        T  *= 0.99  # giam nhiet
        rt  = random.uniform(0, 1)

        # Luu snapshot trang thai hien tai
        snap_matrix          = copy.deepcopy(matrix)
        snap_free            = copy.deepcopy(free)
        snap_filled          = copy.deepcopy(filled)
        snap_groups_es       = copy.deepcopy(groups_empty_space)
        snap_teachers_es     = copy.deepcopy(teachers_empty_space)
        snap_subjects_order  = copy.deepcopy(subjects_order)

        # Dot bien ngau nhien 25% so buoi hoc
        class_indices = list(data.classes.keys())
        for _ in range(len(class_indices) // 4):
            idx = random.choice(class_indices)
            mutate_ideal_spot(matrix, data, idx, free, filled,
                              groups_empty_space, teachers_empty_space, subjects_order)

        # Tinh soft cost moi
        new_soft, _ = calculate_soft_constraints(
            matrix, data, groups_empty_space, teachers_empty_space
        )
        new_cost = new_soft

        # Chap nhan hay tu choi theo quy tac SA
        if new_cost < curr_cost or rt <= math.exp((curr_cost - new_cost) / max(T, 1e-9)):
            curr_cost = new_cost   # giu trang thai moi
        else:
            # Phuc hoi snapshot cu
            matrix.clear()
            matrix.extend(snap_matrix)
            free.clear();           free.extend(snap_free)
            filled.clear();         filled.update(snap_filled)
            groups_empty_space.clear();   groups_empty_space.update(snap_groups_es)
            teachers_empty_space.clear(); teachers_empty_space.update(snap_teachers_es)
            subjects_order.clear();       subjects_order.update(snap_subjects_order)

        if i % 250 == 0:
            print(f'  Iter {i:4d} | T={T:.6f} | soft_cost={curr_cost:.4f}')

    print(f'\n=== KET QUA SAU HARDENING ===')
    show_timetable(matrix)
    show_statistics(matrix, data, subjects_order, groups_empty_space, teachers_empty_space)

    # In fitness cuoi cung day du
    _, hard, soft, hd, sd = calculate_fitness(
        matrix, data, groups_empty_space, teachers_empty_space
    )
    log_fitness(hard, soft, hd, sd, prefix='FINAL ')

    write_solution_to_file(matrix, data, filled, file,
                           groups_empty_space, teachers_empty_space, subjects_order)


# ============================================================
# MAIN
# ============================================================

def main():
    """
    Luong chinh:
      load_data -> set_up -> initial_population
      -> evolutionary_algorithm (giai hard constraints)
      -> simulated_hardening     (toi uu soft constraints)
      -> ghi file ket qua

    Cac cau truc du lieu chinh:
      matrix      : TOTAL_SLOTS x n_rooms, o = class_index hoac None
      free        : list (row, col) cac o chua su dung
      filled      : {class_idx: [(row,col), ...]} - buoi hoc dang o dau
      subjects_order    : {(mamon, group_idx): {'LT': row, 'TH': row}}
      groups_empty_space: {group_idx: [list hang dang co mat]}
      teachers_empty_space: {magv: [list hang dang day]}
    """
    filled               = {}
    subjects_order       = {}
    groups_empty_space   = {}
    teachers_empty_space = {}

    # WHAT changed: tu 'ulaz1.txt' sang 'mock_data.json'
    # WHY: dung mock data moi theo schema Viet hoa, 6 ngay x 12 tiet
    file = 'mock_data.json'

    print('=== LOAD DATA ===')
    data = load_data('test_files/' + file,
                     teachers_empty_space, groups_empty_space, subjects_order)

    print(f'  So buoi hoc (Class objects): {len(data.classes)}')
    print(f'  So phong hoc               : {len(data.classrooms)}')
    print(f'  So lop                     : {len(data.groups)}')
    print(f'  So giang vien              : {len(data.teachers)}')

    matrix, free = set_up(len(data.classrooms))
    print(f'  Matrix size                : {len(matrix)} rows x {len(matrix[0])} cols')

    print('\n=== KHOI TAO LICH BAN DAU ===')
    initial_population(data, matrix, free, filled,
                       groups_empty_space, teachers_empty_space, subjects_order)

    init_hard, init_details = calculate_hard_constraints(matrix, data)
    init_soft, init_soft_d  = calculate_soft_constraints(
        matrix, data, groups_empty_space, teachers_empty_space
    )
    print(f'Chi phi ban dau:')
    log_fitness(init_hard, init_soft, init_details, init_soft_d, prefix='  ')

    print('\n=== EVOLUTIONARY ALGORITHM (Giai hard constraints) ===')
    evolutionary_algorithm(matrix, data, free, filled,
                           groups_empty_space, teachers_empty_space, subjects_order)

    print('\n=== THONG KE SAU EVOLUTIONARY ===')
    show_statistics(matrix, data, subjects_order, groups_empty_space, teachers_empty_space)

    print('\n=== SIMULATED ANNEALING (Toi uu soft constraints) ===')
    simulated_hardening(matrix, data, free, filled,
                        groups_empty_space, teachers_empty_space, subjects_order, file)


if __name__ == '__main__':
    main()

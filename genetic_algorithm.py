"""
genetic_algorithm.py
====================
Giải thuật Di truyền (Genetic Algorithm) để lập Thời Khóa Biểu.

Sơ đồ GA:
  ┌─────────────────────────────────┐
  │  Khởi tạo quần thể N cá thể    │
  └────────────────┬────────────────┘
                   ▼
  ┌─────────────────────────────────┐
  │    Đánh giá fitness toàn bộ     │◄──────────────────────────┐
  └────────────────┬────────────────┘                           │
                   ▼                                            │
         Đạt điều kiện dừng? ──Yes──► Trả về cá thể tốt nhất  │
                   │ No                                         │
                   ▼                                            │
  ┌─────────────────────────────────┐                          │
  │  Elitism: giữ top-E cá thể     │                          │
  └────────────────┬────────────────┘                          │
                   ▼                                            │
  ┌─────────────────────────────────┐                          │
  │  Tournament Selection (cha/mẹ) │                          │
  └────────────────┬────────────────┘                          │
                   ▼                                            │
  ┌─────────────────────────────────┐                          │
  │  Crossover → 2 con              │                          │
  └────────────────┬────────────────┘                          │
                   ▼                                            │
  ┌─────────────────────────────────┐                          │
  │  Mutation                       │                          │
  └────────────────┬────────────────┘                          │
                   ▼                                            │
  ┌─────────────────────────────────┐                          │
  │  Thế hệ mới                     │──────────────────────────┘
  └─────────────────────────────────┘

Mã hóa nhiễm sắc thể (Chromosome Encoding):
  - Chromosome = matrix [TOTAL_SLOTS × n_rooms]
  - Gen        = matrix[row][col] = class_index | None
  - row (0-71) = tiết học (6 ngày × 12 tiết/ngày)
  - col        = phòng học (index)

Hàm thích nghi (Fitness Function):
  fitness = hard_cost × HARD_WEIGHT + soft_cost   (minimize)
  - hard_cost = 0  ↔  lịch hoàn toàn hợp lệ
  - soft_cost thấp ↔  lịch đẹp (ít tiết trống, không phân mảnh sáng/chiều...)
"""

import random
import copy
import time
from utils import (
    load_data, load_data_from_raw, show_timetable, set_up, show_statistics,
    write_solution_to_file, SLOTS_PER_DAY, MORNING_SLOTS, TOTAL_SLOTS,
)
from costs import (
    calculate_fitness,
    log_fitness,
)
from helpers import (
    initial_population,
    initial_population_random,
    mutate_ideal_spot,
    _get_valid_start_slots,
    _check_session_boundary,
    insert_order,
)


# ============================================================
# THAM SỐ GA
# ============================================================

POP_SIZE       = 20    # Kích thước quần thể
MAX_GEN        = 500   # Số thế hệ tối đa
CROSSOVER_RATE = 0.85  # Xác suất lai ghép một cặp cha/mẹ
MUTATION_RATE  = 0.15  # Xác suất đột biến mỗi buổi học
TOURNAMENT_K   = 3     # Số cá thể tham gia mỗi tournament
ELITISM        = 2     # Số cá thể tốt nhất giữ nguyên sang thế hệ sau


# ============================================================
# CÁ THỂ (INDIVIDUAL = CHROMOSOME)
# ============================================================

class Individual:
    """
    1 cá thể trong quần thể GA = 1 lời giải thời khóa biểu.

    Nhiễm sắc thể (chromosome) = matrix TOTAL_SLOTS × n_rooms.
    Mỗi gen = 1 ô matrix[row][col]:
      - Giá trị = class_index  →  buổi học đang chiếm ô này
      - Giá trị = None         →  ô trống

    Kèm theo các cấu trúc phụ trợ để tính fitness và hỗ trợ mutation:
      free                : [(row, col)] — danh sách ô còn trống
      filled              : {class_idx: [(row,col),...]} — vị trí từng buổi học
      groups_empty_space  : {group_idx: [rows]} — tiết lớp đang có mặt
      teachers_empty_space: {magv: [rows]}      — tiết GV đang dạy
      subjects_order      : {(mamon, grp): {'LT': row, 'TH': row}}
    """

    def __init__(self, matrix, free, filled,
                 groups_empty_space, teachers_empty_space, subjects_order):
        self.matrix               = matrix
        self.free                 = free
        self.filled               = filled
        self.groups_empty_space   = groups_empty_space
        self.teachers_empty_space = teachers_empty_space
        self.subjects_order       = subjects_order
        self._fitness             = None   # cache — None = cần tính lại

    # ----------------------------------------------------------
    # Fitness
    # ----------------------------------------------------------

    def evaluate(self, data):
        """
        Tính fitness và lưu vào cache.
        Gọi lại sau bất kỳ thay đổi nào của chromosome.

        Trả về (total, hard, soft, hard_details, soft_details).
        """
        total, hard, soft, hd, sd = calculate_fitness(
            self.matrix, data,
            self.groups_empty_space, self.teachers_empty_space,
        )
        self._fitness = total
        return total, hard, soft, hd, sd

    def get_fitness(self, data):
        """Trả về fitness từ cache; tính nếu chưa có."""
        if self._fitness is None:
            self.evaluate(data)
        return self._fitness

    def invalidate(self):
        """Xóa cache khi chromosome bị thay đổi."""
        self._fitness = None

    # ----------------------------------------------------------
    # Clone
    # ----------------------------------------------------------

    def clone(self):
        """Deep copy toàn bộ cá thể (dùng cho elitism và snapshot)."""
        return Individual(
            matrix               = copy.deepcopy(self.matrix),
            free                 = copy.deepcopy(self.free),
            filled               = copy.deepcopy(self.filled),
            groups_empty_space   = copy.deepcopy(self.groups_empty_space),
            teachers_empty_space = copy.deepcopy(self.teachers_empty_space),
            subjects_order       = copy.deepcopy(self.subjects_order),
        )


# ============================================================
# KHỞI TẠO QUẦN THỂ (POPULATION INITIALIZATION)
# ============================================================

def _make_empty_individual(data, n_rooms):
    """
    Tạo 1 cá thể rỗng: matrix toàn None, free gồm tất cả ô.
    Dùng làm nền để crossover xây dựng con mới.
    """
    matrix = [[None] * n_rooms for _ in range(TOTAL_SLOTS)]
    free   = [(r, c) for r in range(TOTAL_SLOTS) for c in range(n_rooms)]
    return Individual(
        matrix               = matrix,
        free                 = free,
        filled               = {},
        groups_empty_space   = {idx: [] for idx in range(len(data.groups))},
        teachers_empty_space = {magv: [] for magv in data.teachers},
        subjects_order       = {},
    )


def create_individual(data, n_rooms):
    """
    Tạo 1 cá thể mới bằng random initialization (GA thuần).
    Với mỗi buổi học, thu thập tất cả vị trí hợp lệ rồi chọn ngẫu nhiên.
    """
    ind = _make_empty_individual(data, n_rooms)
    initial_population_random(
        data, ind.matrix, ind.free, ind.filled,
        ind.groups_empty_space, ind.teachers_empty_space, ind.subjects_order,
    )
    return ind


def init_population(data, n_rooms, pop_size=POP_SIZE):
    """
    Khởi tạo quần thể ban đầu gồm pop_size cá thể.
    Mỗi cá thể được tạo độc lập bằng random initialization.
    """
    print(f'Khởi tạo quần thể ({pop_size} cá thể)...')
    population = []
    for i in range(pop_size):
        ind = create_individual(data, n_rooms)
        population.append(ind)
        print(f'  [{i + 1:2d}/{pop_size}]', end='\r')
    print()
    return population


# ============================================================
# CHỌN LỌC (SELECTION) — Tournament Selection
# ============================================================

def tournament_selection(population, data, k=TOURNAMENT_K):
    """
    Tournament Selection:
      1. Chọn ngẫu nhiên k cá thể từ quần thể.
      2. Trả về cá thể có fitness nhỏ nhất (tốt nhất) trong nhóm đó.

    Tham số k kiểm soát "áp lực chọn lọc":
      - k nhỏ → ít áp lực, đa dạng hơn (khó hội tụ)
      - k lớn → áp lực cao, hội tụ nhanh hơn (dễ kẹt cực tiểu địa phương)
    """
    contestants = random.sample(population, min(k, len(population)))
    return min(contestants, key=lambda ind: ind.get_fitness(data))


# ============================================================
# LAI GHÉP (CROSSOVER) — Uniform Crossover ở mức buổi học
# ============================================================

def _place_fields(child, idx, fields, cls):
    """
    Đặt buổi học idx vào tập vị trí fields trong cá thể child.
    Cập nhật: matrix, free, filled, groups_empty_space,
              teachers_empty_space, subjects_order.
    """
    start_row = fields[0][0]
    for (row, col) in fields:
        child.matrix[row][col] = idx
        child.free.remove((row, col))
        child.filled.setdefault(idx, []).append((row, col))
        child.teachers_empty_space[cls.teacher].append(row)
        for g in cls.groups:
            child.groups_empty_space[g].append(row)

    for g in cls.groups:
        insert_order(child.subjects_order, cls.subject, g, cls.type, start_row)


def _greedy_place_single(child, idx, cls):
    """
    Đặt 1 buổi học chưa xếp bằng greedy: duyệt free, lấy vị trí hợp lệ đầu tiên.
    Dùng khi cả 2 cha/mẹ đều bị xung đột (fallback trong crossover).
    Trả về True nếu đặt được.
    """
    free_set = set(child.free)   # O(1) lookup

    for start_field in child.free:
        start_row = start_field[0]
        end_row   = start_row + int(cls.duration) - 1

        # Không tràn sang ngày hôm sau
        if start_row % SLOTS_PER_DAY > end_row % SLOTS_PER_DAY:
            continue

        # Tiết bắt đầu hợp lệ theo loại môn
        slot_in_day = start_row % SLOTS_PER_DAY + 1
        if slot_in_day not in _get_valid_start_slots(cls):
            continue

        # Không vượt ranh giới sáng/chiều
        if not _check_session_boundary(start_row, cls.duration):
            continue

        # Đúng loại phòng
        if start_field[1] not in cls.classrooms:
            continue

        # Toàn bộ block còn trống
        fields = [(start_row + offset, start_field[1])
                  for offset in range(int(cls.duration))]
        if all(f in free_set for f in fields):
            _place_fields(child, idx, fields, cls)
            return True

    return False   # không tìm được chỗ (hiếm gặp)


def crossover(p1: Individual, p2: Individual, data):
    """
    Uniform Crossover ở mức buổi học → sinh 2 cá thể con.

    Với mỗi buổi học (thứ tự ngẫu nhiên):
      1. Lật đồng xu → ưu tiên lấy vị trí từ p1 hoặc p2
      2. Kiểm tra: tất cả ô trong vị trí đó có còn trống ở child không?
      3. Nếu có → đặt vào child (gen được thừa hưởng)
      4. Nếu không → thử parent còn lại
      5. Nếu cả 2 đều xung đột → greedy fallback (tìm ô mới)

    WHY uniform (không phải 1-point / 2-point):
      Các buổi học không có thứ tự tự nhiên trên nhiễm sắc thể,
      nên cắt theo điểm cắt cứng không có ý nghĩa sinh học.
      Uniform cho phép kế thừa tự do từ bất kỳ phần nào của cha/mẹ.
    """
    n_rooms = len(p1.matrix[0])
    children = []

    # Tạo 2 con theo 2 hướng ưu tiên ngược nhau
    for (primary, secondary) in [(p1, p2), (p2, p1)]:
        child = _make_empty_individual(data, n_rooms)

        # Xáo trộn thứ tự xử lý buổi học để tránh bias
        class_indices = list(data.classes.keys())
        random.shuffle(class_indices)

        for idx in class_indices:
            cls = data.classes[idx]
            placed = False

            # 50/50: ưu tiên primary hay secondary trước
            order = ([primary, secondary]
                     if random.random() < 0.5
                     else [secondary, primary])

            free_set = set(child.free)   # refresh sau mỗi lần đặt

            for parent in order:
                fields = parent.filled.get(idx)
                if not fields:
                    continue
                if all(f in free_set for f in fields):
                    _place_fields(child, idx, fields, cls)
                    placed = True
                    break

            if not placed:
                # Fallback: tìm ô mới bằng greedy
                _greedy_place_single(child, idx, cls)

        children.append(child)

    return children[0], children[1]


# ============================================================
# ĐỘT BIẾN (MUTATION)
# ============================================================

def mutate(individual: Individual, data, mutation_rate=MUTATION_RATE):
    """
    Đột biến: với mỗi buổi học, với xác suất mutation_rate,
    dịch chuyển sang vị trí mới không xung đột (dùng mutate_ideal_spot).

    WHY dùng mutate_ideal_spot từ scheduler.py:
      - Đã được kiểm chứng: luôn tìm vị trí hợp lệ (không tạo vi phạm mới)
      - Nhất quán với phần EA hiện có
    """
    changed = False
    for idx in list(individual.filled.keys()):
        if random.random() < mutation_rate:
            mutate_ideal_spot(
                individual.matrix, data, idx,
                individual.free, individual.filled,
                individual.groups_empty_space,
                individual.teachers_empty_space,
                individual.subjects_order,
            )
            changed = True

    if changed:
        individual.invalidate()

    return individual


# ============================================================
# VÒNG LẶP GA CHÍNH
# ============================================================

def genetic_algorithm(data, n_rooms, file,
                      pop_size=POP_SIZE, max_gen=MAX_GEN, raw_data=None):
    """
    Vòng lặp Giải thuật Di truyền chính.

    Tham số:
      data     : Data object (groups, teachers, classes, classrooms)
      n_rooms  : số phòng học (= số cột matrix)
      file     : tên file dữ liệu đầu vào (để ghi kết quả)
      pop_size : kích thước quần thể
      max_gen  : số thế hệ tối đa

    Trả về cá thể tốt nhất tìm được.
    """
    # ----------------------------------------------------------
    # Bước 1: Khởi tạo quần thể
    # ----------------------------------------------------------
    population = init_population(data, n_rooms, pop_size)

    # ----------------------------------------------------------
    # Bước 2: Đánh giá fitness ban đầu
    # ----------------------------------------------------------
    for ind in population:
        ind.evaluate(data)

    population.sort(key=lambda i: i.get_fitness(data))
    best = population[0].clone()

    print(f'\n[Gen 0] Fitness tốt nhất: {best.get_fitness(data)}')
    _, hard0, soft0, hd0, sd0 = best.evaluate(data)
    log_fitness(hard0, soft0, hd0, sd0, prefix='  ')
    history = [{'generation': 0, 'best_cost': best.get_fitness(data)}]
    last_generation = 0

    # ----------------------------------------------------------
    # Bước 3: Vòng lặp tiến hóa
    # ----------------------------------------------------------
    for gen in range(1, max_gen + 1):

        # --- Kiểm tra điều kiện dừng sớm ---
        if best.get_fitness(data) == 0:
            print(f'\n[GA] Tìm được lịch tối ưu (fitness=0) tại thế hệ {gen - 1}!')
            break

        new_pop = []

        # --- Elitism: giữ ELITISM cá thể tốt nhất ---
        population.sort(key=lambda i: i.get_fitness(data))
        for i in range(ELITISM):
            new_pop.append(population[i].clone())

        # --- Selection + Crossover + Mutation ---
        while len(new_pop) < pop_size:
            parent1 = tournament_selection(population, data, TOURNAMENT_K)
            parent2 = tournament_selection(population, data, TOURNAMENT_K)

            # Lai ghép
            if random.random() < CROSSOVER_RATE:
                child1, child2 = crossover(parent1, parent2, data)
            else:
                child1 = parent1.clone()
                child2 = parent2.clone()

            # Đột biến
            child1 = mutate(child1, data, MUTATION_RATE)
            child2 = mutate(child2, data, MUTATION_RATE)

            new_pop.append(child1)
            if len(new_pop) < pop_size:
                new_pop.append(child2)

        # --- Đánh giá thế hệ mới ---
        for ind in new_pop:
            ind.evaluate(data)

        population = new_pop

        # --- Cập nhật cá thể tốt nhất toàn cục ---
        gen_best = min(population, key=lambda i: i.get_fitness(data))
        if gen_best.get_fitness(data) < best.get_fitness(data):
            best = gen_best.clone()

        last_generation = gen
        history.append({'generation': gen, 'best_cost': best.get_fitness(data)})

        # --- Log mỗi 10 thế hệ ---
        if gen % 10 == 0:
            _, hard, soft, hd, sd = best.evaluate(data)
            avg_fit = sum(i.get_fitness(data) for i in population) / len(population)
            print(f'\n[Gen {gen:3d}/{max_gen}] Best={best.get_fitness(data)} | '
                  f'Avg={avg_fit:.1f} | Hard={hard} | Soft={soft}')
            log_fitness(hard, soft, hd, sd, prefix='  ')

    # ----------------------------------------------------------
    # Bước 4: In kết quả cuối
    # ----------------------------------------------------------
    print(f'\n{"=" * 50}')
    print(f'KẾT QUẢ SAU {max_gen} THẾ HỆ')
    print(f'{"=" * 50}')
    show_timetable(best.matrix)
    show_statistics(
        best.matrix, data, best.subjects_order,
        best.groups_empty_space, best.teachers_empty_space,
    )
    _, hard_f, soft_f, hd_f, sd_f = best.evaluate(data)
    log_fitness(hard_f, soft_f, hd_f, sd_f, prefix='FINAL ')

    write_solution_to_file(
        best.matrix, data, best.filled, file,
        best.groups_empty_space, best.teachers_empty_space, best.subjects_order,
        raw_data=raw_data,
    )

    best.ga_history = history
    best.ga_generation = last_generation

    return best


def run_ga_with_raw(raw_data, file='supabase_runtime.json',
                    pop_size=POP_SIZE, max_gen=MAX_GEN, tuanhoc=None):
    """
    Chay GA voi du lieu da nap san (dict), phu hop khi goi tu backend API.
    Tra ve ket qua de luu CSDL ma khong can doc mock file.

    :param tuanhoc: so tuan dang xep lich — truyen vao load_data_from_raw de
                    bo qua cac phan_cong da vuot so_tuan_can_hoc.
                    None = khong loc theo tuan (dung khi goi thu nghiem).
    """
    data = load_data_from_raw(raw_data, {}, {}, {}, tuanhoc=tuanhoc)
    n_rooms = len(data.classrooms)
    started_at = time.perf_counter()
    best = genetic_algorithm(
        data,
        n_rooms,
        file,
        pop_size=pop_size,
        max_gen=max_gen,
        raw_data=raw_data,
    )
    runtime_seconds = time.perf_counter() - started_at

    sessions = []
    for class_idx, fields in best.filled.items():
        cls = data.classes[class_idx]
        sorted_fields = sorted(fields, key=lambda item: item[0])
        first_row = sorted_fields[0][0]
        room_idx = sorted_fields[0][1]
        day_index = first_row // SLOTS_PER_DAY
        start_slot = first_row % SLOTS_PER_DAY + 1
        end_slot = start_slot + int(cls.duration) - 1

        sessions.append({
            'class_index': class_idx,
            'mapc': cls.assignment_id,
            'mamon': cls.subject,
            'magv': cls.teacher,
            'malop_index': cls.groups[0] if cls.groups else None,
            'loaiphong': cls.type,
            'maphong': data.classrooms[room_idx].name,
            'day_index': day_index,
            'start_slot': start_slot,
            'end_slot': end_slot,
            'slot_numbers': list(range(start_slot, end_slot + 1)),
        })

    total_cost, hard_cost, soft_cost, hard_details, soft_details = best.evaluate(data)
    breakdown = {
        'teacher_conflicts': hard_details.get('teacher_conflicts', 0),
        'class_conflicts': hard_details.get('group_conflicts', 0),
        'room_type_conflicts': hard_details.get('classroom_mismatches', 0),
        'same_assignment_same_day': hard_details.get('same_assignment_day', 0),
        'student_gaps': soft_details.get('empty_groups', 0),
        'teacher_gaps': soft_details.get('empty_teachers', 0),
        'fragmentation': soft_details.get('fragmentation', 0),
        'same_subject_same_day': soft_details.get('same_subject_same_day', 0),
        'specialization_mismatch': soft_details.get('specialization_mismatch', 0),
        'total_soft_penalty': soft_cost,
    }

    return {
        'summary': {
            'classes': len(data.classes),
            'rooms': len(data.classrooms),
            'groups': len(data.groups),
            'teachers': len(data.teachers),
            'sessions': len(sessions),
            'fitness': total_cost,
            'total_cost': total_cost,
            'hard_cost': hard_cost,
            'soft_cost': soft_cost,
            'generation': getattr(best, 'ga_generation', max_gen),
            'max_generation': max_gen,
            'runtime_seconds': round(runtime_seconds, 3),
            'is_valid': hard_cost == 0,
        },
        'history': getattr(best, 'ga_history', []),
        'breakdown': breakdown,
        'sessions': sessions,
    }


# ============================================================
# MAIN
# ============================================================

def main():
    """
    Luồng chính:
      load_data → init_population → genetic_algorithm → ghi kết quả
    """
    file = 'mock_data.json'

    print('=== LOAD DATA ===')
    # Các dict này chỉ dùng khi load; mỗi Individual có bản riêng của mình
    data = load_data('test_files/' + file, {}, {}, {})

    print(f'  Buổi học : {len(data.classes)}')
    print(f'  Phòng    : {len(data.classrooms)}')
    print(f'  Lớp      : {len(data.groups)}')
    print(f'  GV       : {len(data.teachers)}')

    n_rooms = len(data.classrooms)

    print(f'\n=== GENETIC ALGORITHM ===')
    print(f'  Pop size : {POP_SIZE}')
    print(f'  Max gen  : {MAX_GEN}')
    print(f'  Crossover: {CROSSOVER_RATE}')
    print(f'  Mutation : {MUTATION_RATE}')
    print(f'  Tournament k={TOURNAMENT_K}, Elitism={ELITISM}')

    best = genetic_algorithm(data, n_rooms, file,
                             pop_size=POP_SIZE, max_gen=MAX_GEN)
    return best


if __name__ == '__main__':
    main()

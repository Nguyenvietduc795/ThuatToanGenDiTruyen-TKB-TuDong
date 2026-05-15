# TKB-TuDong — Hệ Thống Xếp Thời Khóa Biểu Tự Động

[![Python](https://img.shields.io/badge/Python-3.10%2B-blue?logo=python)](https://www.python.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green?logo=node.js)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-5.x-black?logo=express)](https://expressjs.com/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?logo=supabase)](https://supabase.com/)
[![HuggingFace](https://img.shields.io/badge/Demo-HuggingFace%20Spaces-FFD21E?logo=huggingface)](https://huggingface.co/spaces/Nguyenvietduc795/ThuatToanGenDiTruyen-TKB-TuDong)
[![License](https://img.shields.io/badge/License-ISC-lightgrey)](LICENSE)

Hệ thống xếp thời khóa biểu tự động cho khoa/trường đại học, sử dụng **Thuật Toán Di Truyền (Genetic Algorithm)** viết bằng Python và phục vụ qua backend **Node.js / Express**. Người dùng quản lý giảng viên, lớp học, môn học, phòng học qua giao diện web, sau đó hệ thống tự động sinh thời khóa biểu không xung đột thỏa mãn cả ràng buộc cứng lẫn ràng buộc mềm.

---

## Demo trực tuyến

> **[Mở trên Hugging Face Spaces →](https://huggingface.co/spaces/Duc7925/tkb-ga-ai)**

---

## Mục lục

- [Kiến trúc tổng quan](#kiến-trúc-tổng-quan)
- [Cách thuật toán di truyền hoạt động](#cách-thuật-toán-di-truyền-hoạt-động)
  - [Mã hóa nhiễm sắc thể](#1-mã-hóa-nhiễm-sắc-thể)
  - [Khởi tạo quần thể](#2-khởi-tạo-quần-thể)
  - [Hàm Fitness](#3-hàm-fitness)
  - [Chọn lọc](#4-chọn-lọc--tournament-selection)
  - [Lai ghép](#5-lai-ghép--uniform-crossover)
  - [Đột biến](#6-đột-biến--smart-mutation)
  - [Vòng lặp GA & tham số](#7-vòng-lặp-ga--tham-số)
- [Điểm khác biệt so với GA cổ điển](#điểm-khác-biệt-so-với-ga-cổ-điển)
- [Tính năng: Lịch rảnh riêng của giảng viên](#tính-năng-lịch-rảnh-riêng-của-giảng-viên)
- [Cài đặt](#cài-đặt)
- [Chạy dự án](#chạy-dự-án)
- [Kết quả](#kết-quả)
- [Tài liệu tham khảo](#tài-liệu-tham-khảo)

---

## Kiến trúc tổng quan

```
Trình duyệt (HTML/CSS/JS)
        │  HTTP REST
        ▼
Node.js / Express  ──── Supabase (PostgreSQL)
        │
        │  spawnSync stdin/stdout
        ▼
Python GA Engine
  ├── ga_cli.py              Đầu vào (nhận JSON) / đầu ra (trả JSON)
  ├── genetic_algorithm.py   Vòng lặp GA, lớp Individual
  ├── costs.py               fitness = hard × 100 + soft
  ├── helpers.py             Khởi tạo quần thể, crossover, mutation
  ├── model.py               Data model (Class, Classroom, Data)
  └── utils.py               Hằng số, nạp dữ liệu
```

**Luồng xử lý khi sinh thời khóa biểu:**

1. Người dùng chọn học kỳ, lớp, môn học trên `tkb_viewer.html`
2. Frontend gọi `POST /api/ga/generate` với các tham số đã chọn
3. Node.js lấy dữ liệu từ Supabase, lọc theo lựa chọn, đóng gói thành JSON
4. Python GA nhận JSON qua `stdin`, chạy thuật toán, trả về danh sách buổi học qua `stdout`
5. Node.js mở rộng kết quả 1 tuần ra toàn bộ các tuần cần thiết, áp dụng rule LT trước TH, lưu vào bảng `thoi_khoa_bieu`
6. Frontend render lưới thời khóa biểu theo từng tuần

---

## Cách thuật toán di truyền hoạt động

### 1. Mã hóa nhiễm sắc thể

Mỗi **cá thể** (lời giải ứng viên) là một ma trận 2 chiều:

```
matrix[hàng][cột] = class_index | None

  hàng  :  0 – 71  →  6 ngày × 12 tiết = 72 hàng
  cột   :  0 – n-1 →  n phòng học
  giá trị: class_index (buổi học đang chiếm ô này)
            None        (ô trống)
```

Vì một buổi học có `duration = d` tiết sẽ chiếm `d` hàng liên tiếp trên cùng một cột, ma trận đảm bảo **tối đa một buổi học trên mỗi phòng mỗi tiết** theo cấu trúc — không cần kiểm tra thêm.

```
Ví dụ (2 phòng, ngày Thứ 2):
         Phòng 0    Phòng 1
Tiết 1    [ 3 ]      [   ]
Tiết 2    [ 3 ]      [ 7 ]
Tiết 3    [ 3 ]      [ 7 ]
Tiết 4    [   ]      [ 7 ]
...
```

Buổi học số 3 chiếm Phòng 0, Tiết 1–3 (duration = 3).  
Buổi học số 7 chiếm Phòng 1, Tiết 2–4 (duration = 3).

---

### 2. Khởi tạo quần thể

**`initial_population_random()` — khởi tạo ngẫu nhiên có hướng dẫn (heuristic-guided)**

Với mỗi buổi học, thuật toán thu thập **tất cả vị trí hợp lệ** rồi chọn ngẫu nhiên một cái. Một vị trí được coi là hợp lệ khi:

| Điều kiện | Quy tắc |
|---|---|
| Đúng loại phòng | Cột phải thuộc danh sách phòng cho phép của buổi học (LT hoặc TH) |
| Không tràn ngày | `start_row % 12 ≤ end_row % 12` |
| Ranh giới sáng/chiều | Buổi học không được kéo dài qua ranh giới 6 tiết sáng/chiều |
| Tiết bắt đầu hợp lệ | `duration=5` → chỉ tiết 1 hoặc 7; `duration=3` → tiết 1, 4, 7 hoặc 10 |
| Cùng phân công khác ngày | Hai buổi của cùng `mapc` phải được xếp vào hai ngày khác nhau |

Xung đột giảng viên/lớp **không được kiểm tra** ở bước này — GA sẽ giải quyết thông qua hàm fitness trong quá trình tiến hóa.

---

### 3. Hàm Fitness

```
fitness(cá thể) = hard_cost × 100 + soft_cost        [TỐI THIỂU HÓA]
```

Fitness bằng **0** nghĩa là thời khóa biểu hoàn hảo, không vi phạm bất kỳ ràng buộc nào.

#### Ràng buộc cứng (`trọng số = 100` mỗi vi phạm)

| Mã | Quy tắc | Cách phát hiện |
|---|---|---|
| H1 | Giảng viên không được dạy 2 lớp cùng tiết | Duyệt từng hàng, phát hiện các cặp ô có cùng `teacher` |
| H2 | Lớp không được học 2 môn cùng tiết | Duyệt từng hàng, phát hiện các cặp ô có chung `group` |
| H3 | Mỗi buổi học phải được xếp đúng loại phòng (LT / TH) | Kiểm tra `col ∈ cls.classrooms` với mọi ô đã điền |
| H4 | Hai buổi của cùng phân công (`mapc`) không được xếp cùng ngày | Nhóm theo ngày, đếm số lần `mapc` xuất hiện trong ngày |
| H5 | Giảng viên không được xếp ngoài ngày/buổi khả dụng (`ngay_available`, `buoi_available`) | Duyệt từng buổi học, kiểm tra `row ∈ teacher_available_rows[magv]`; GV không có dữ liệu lịch rảnh → bỏ qua |
| H6 | Giảng viên không được xếp vào buổi bận cố định (`gv_blackout_slots`) | Duyệt từng buổi học, kiểm tra `row ∈ teacher_blackout_rows[magv]`; GV không có blackout → bỏ qua |

#### Ràng buộc mềm (`trọng số = 1` mỗi vi phạm)

| Mã | Quy tắc | Cách phạt |
|---|---|---|
| S1 | Giảm thiểu tiết trống của sinh viên (khoảng cách giữa các tiết trong ngày) | +1 mỗi tiết trống giữa các buổi học trong ngày của lớp |
| S2 | Giảm thiểu tiết trống của giảng viên | +1 mỗi tiết trống giữa các buổi dạy trong ngày của GV |
| S3 | Không phân mảnh lịch học của lớp sang cả sáng lẫn chiều trong cùng ngày | +1 mỗi lớp bị chia đôi sáng/chiều trong ngày |
| S4 | Không xếp cùng môn học nhiều hơn một lần trong ngày cho cùng lớp | +1 mỗi buổi dư thừa |
| S5 | Giảng viên nên dạy đúng chuyên môn | +1 mỗi cặp (GV, môn học) không khớp chuyên môn |

Vi phạm ràng buộc cứng bị phạt **nặng hơn 100 lần** so với ràng buộc mềm, đảm bảo GA luôn ưu tiên giải quyết xung đột trước khi tối ưu hóa chất lượng.

---

### 4. Chọn lọc — Tournament Selection

```python
def tournament_selection(population, data, k=3):
    contestants = random.sample(population, k)          # chọn 3 cá thể ngẫu nhiên
    return min(contestants, key=lambda ind: ind.get_fitness(data))  # lấy fitness thấp nhất
```

Ba cá thể được rút ngẫu nhiên; cá thể có **fitness thấp nhất** (ít vi phạm nhất) thắng. Gọi 2 lần để chọn `parent1` và `parent2`.

**Tại sao dùng Tournament thay vì Roulette Wheel?**
- Không phụ thuộc vào scale của fitness — hoạt động đúng bất kể giá trị fitness lớn hay nhỏ
- `k = 3` cân bằng giữa **đa dạng gen** (tránh hội tụ sớm) và **áp lực chọn lọc** (tốc độ hội tụ). `k` lớn hơn hội tụ nhanh hơn nhưng dễ kẹt cực tiểu địa phương.

---

### 5. Lai ghép — Uniform Crossover

```
Với mỗi buổi học (thứ tự xáo trộn ngẫu nhiên):
  1. Tung đồng xu → ưu tiên lấy từ parent A hay parent B trước
  2. Kế thừa vị trí buổi học từ parent được ưu tiên
     nếu toàn bộ ô trong vị trí đó còn trống ở child
  3. Nếu bị chiếm → thử parent còn lại
  4. Nếu cả 2 đều xung đột → greedy fallback (tìm ô hợp lệ mới)
```

Mỗi lần lai ghép sinh ra 2 con theo 2 hướng ưu tiên ngược nhau `(A→B)` và `(B→A)`.

**Tại sao dùng Uniform thay vì 1-point hay 2-point crossover?**

Các buổi học không có thứ tự tự nhiên trong ma trận 2 chiều. Cắt theo điểm cứng trên ma trận không mang ý nghĩa gì về mặt lịch học. Uniform crossover cho phép mỗi buổi học được kế thừa độc lập từ bất kỳ parent nào, bảo toàn các "gen tốt" bất kể chúng nằm ở đâu trong ma trận.

---

### 6. Đột biến — Smart Mutation

```python
for each buổi học in cá thể:
    if random.random() < MUTATION_RATE:          # 15% xác suất
        mutate_ideal_spot(buổi học, ...)
```

`mutate_ideal_spot` **không** chọn ô ngẫu nhiên. Nó duyệt danh sách ô trống và di chuyển buổi học đến **ô đầu tiên không tạo ra vi phạm ràng buộc cứng mới**:

- ✅ Đúng loại phòng
- ✅ Không tràn ngày / không vượt ranh giới sáng/chiều
- ✅ Tiết bắt đầu hợp lệ
- ✅ Không gây xung đột giảng viên tại hàng mới
- ✅ Không gây xung đột lớp tại hàng mới
- ✅ Cùng `mapc` chưa được xếp vào ngày đó

Nếu không tìm được ô hợp lệ, buổi học **giữ nguyên vị trí cũ**. Điều này đảm bảo đột biến không bao giờ làm tăng số vi phạm ràng buộc cứng.

---

### 7. Vòng lặp GA & tham số

```
Thế hệ 0 : Khởi tạo 20 cá thể ngẫu nhiên, tính fitness, lưu cá thể tốt nhất

Lặp từ thế hệ 1 đến 500:
  ├─ Dừng sớm nếu best.fitness == 0
  ├─ Elitism : clone 2 cá thể tốt nhất vào thế hệ mới
  └─ Lấp đầy 18 chỗ còn lại:
       parent1 ← Tournament(k=3)
       parent2 ← Tournament(k=3)
       85% trường hợp: child1, child2 = Crossover(parent1, parent2)
       15% trường hợp: child1, child2 = Clone(parent1, parent2)
       Đột biến child1 và child2 (15% mỗi buổi học)

  Tính fitness toàn bộ thế hệ mới
  Cập nhật cá thể tốt nhất toàn cục nếu có cải thiện
  Log mỗi 10 thế hệ
```

| Tham số | Giá trị | Ý nghĩa |
|---|---|---|
| `POP_SIZE` | 20 | Kích thước quần thể |
| `MAX_GEN` | 500 | Số thế hệ tối đa |
| `CROSSOVER_RATE` | 0.85 | Xác suất một cặp cha/mẹ được lai ghép |
| `MUTATION_RATE` | 0.15 | Xác suất mỗi buổi học bị đột biến |
| `TOURNAMENT_K` | 3 | Số cá thể tham gia mỗi vòng đấu |
| `ELITISM` | 2 | Số cá thể tốt nhất được giữ nguyên mỗi thế hệ |
| `HARD_WEIGHT` | 100 | Hệ số nhân phạt vi phạm ràng buộc cứng |

---

## Điểm khác biệt so với GA cổ điển

| Khía cạnh | GA cổ điển | Cài đặt trong dự án này |
|---|---|---|
| **Khởi tạo** | Hoàn toàn ngẫu nhiên | Heuristic — chỉ chọn trong tập ô hợp lệ, giảm vi phạm ban đầu ngay từ đầu |
| **Nhiễm sắc thể** | Chuỗi bit hoặc hoán vị 1 chiều | Ma trận 2 chiều `[72 × n_rooms]`; ràng buộc phòng được đảm bảo bởi cấu trúc, không cần tính vào fitness |
| **Lai ghép** | 1-point hoặc 2-point cắt theo vị trí | Uniform crossover theo từng buổi học + greedy fallback khi cả 2 parent xung đột |
| **Đột biến** | Di chuyển ngẫu nhiên | "Ô lý tưởng" — chỉ di chuyển đến ô không tạo vi phạm ràng buộc cứng mới |
| **Hướng tối ưu** | Thường là MAXIMIZE | MINIMIZE tổng vi phạm (`hard × 100 + soft`); `fitness = 0` là lời giải hoàn hảo |

---

## Tính năng: Lịch rảnh riêng của giảng viên

Hệ thống hỗ trợ xếp TKB theo **lịch rảnh cá nhân của từng giảng viên**, phù hợp với các trường có giảng viên thỉnh giảng hoặc hợp đồng bán thời gian.

### Phân loại giảng viên (`loai_gv`)

| Giá trị | Ý nghĩa |
|---|---|
| `co_huu` | Giảng viên cơ hữu — rảnh toàn bộ các ngày trong tuần (không cần khai báo lịch) |
| `thinh_giang` | Giảng viên thỉnh giảng — chỉ rảnh một số ngày/buổi nhất định |
| `hop_dong` | Giảng viên hợp đồng — chỉ rảnh một số ngày/buổi nhất định |

### Cột dữ liệu bổ sung trong bảng `giang_vien`

| Cột | Kiểu | Ý nghĩa | Ví dụ |
|---|---|---|---|
| `ngay_available` | `INT[]` | Danh sách ngày rảnh (2=T2 … 7=T7) | `{6,7}` → chỉ rảnh T6 và T7 |
| `buoi_available` | `TEXT` | Buổi rảnh trong ngày | `'sang'` / `'chieu'` / `'ca_hai'` |

### Cách hoạt động

Trước khi chạy GA, hệ thống chuyển `ngay_available` + `buoi_available` thành tập hàng ma trận hợp lệ (`teacher_available_rows`). Ràng buộc cứng **H5** kiểm tra mỗi buổi học: nếu GV bị xếp ra ngoài tập hàng đó, phạt **+1 × 100 điểm** — ngang bằng các vi phạm H1–H4.

> **Tương thích ngược:** Nếu GV không có dữ liệu `ngay_available` (bản ghi cũ), H5 bỏ qua và không phạt, đảm bảo dữ liệu hiện có không bị ảnh hưởng.

### Buổi bận cố định — Blackout Slots

Ngoài lịch rảnh chung (`ngay_available`, `buoi_available`), hệ thống hỗ trợ khai báo các **buổi bận cụ thể, cố định hàng tuần** cho từng giảng viên — phù hợp với các GV cơ hữu có lịch họp hoặc công việc kiêm nhiệm.

#### Bảng `gv_blackout_slots`

| Cột | Kiểu | Ý nghĩa | Ví dụ |
|---|---|---|---|
| `magv` | `TEXT` | Mã giảng viên | `'GV01'` |
| `ngay` | `INT` | Thứ trong tuần (2=T2 … 7=T7) | `3` → T3 |
| `buoi` | `TEXT` | Buổi bị bận | `'sang'` / `'chieu'` / `'ca_hai'` |

#### Use case thực tế

| Tình huống | Khai báo |
|---|---|
| GV họp Bộ môn sáng T3 hàng tuần | `{magv: 'GV01', ngay: 3, buoi: 'sang'}` |
| GV họp nhóm nghiên cứu chiều T5 | `{magv: 'GV01', ngay: 5, buoi: 'chieu'}` |
| GV kiêm quản trị hệ thống, bận cả ngày T2 | `{magv: 'GV02', ngay: 2, buoi: 'ca_hai'}` |

#### Cách hoạt động

Trước khi chạy GA, hệ thống chuyển danh sách blackout slots thành tập hàng ma trận bị cấm (`teacher_blackout_rows`). Ràng buộc cứng **H6** kiểm tra mỗi buổi học: nếu GV bị xếp vào hàng thuộc tập bị cấm đó, phạt **+1 × 100 điểm**.

**Khác biệt với H5:**

| | H5 — Lịch rảnh (`available_rows`) | H6 — Blackout (`blackout_rows`) |
|---|---|---|
| Đối tượng | GV thỉnh giảng / hợp đồng | GV cơ hữu có lịch kiêm nhiệm |
| Nguồn dữ liệu | Cột `ngay_available` + `buoi_available` trên bảng `giang_vien` | Nhiều dòng trong bảng `gv_blackout_slots` |
| Phạm vi | Quy tắc chung cho cả tuần | Từng buổi cụ thể, linh hoạt per-slot |
| Vi phạm khi | Row **không nằm** trong tập cho phép | Row **nằm trong** tập bị cấm |

> **Tương thích ngược:** GV không có bản ghi nào trong `gv_blackout_slots` → H6 bỏ qua hoàn toàn, không ảnh hưởng dữ liệu cũ.

---

## Cài đặt

### Yêu cầu

| Công cụ | Phiên bản |
|---|---|
| Node.js | ≥ 18 |
| Python | ≥ 3.10 |
| npm | ≥ 9 |

### Cài đặt local

```bash
# 1. Clone repository
git clone https://github.com/Nguyenvietduc795/ThuatToanGenDiTruyen-TKB-TuDong.git
cd ThuatToanGenDiTruyen-TKB-TuDong

# 2. Cài Node.js dependencies
npm install

# 3. Cấu hình biến môi trường
cp .env.local.example .env.local
#   → Điền Supabase URL, anon key và service role key của bạn

# 4. Seed dữ liệu vào database (khung thời gian + phân công giảng dạy)
npm run seed:all
```

### Biến môi trường (`.env.local`)

| Biến | Mô tả |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL dự án Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key (public) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (chỉ dùng phía server) |
| `NEXT_PUBLIC_APP_URL` | URL gốc của ứng dụng (ví dụ: `http://localhost:3000`) |
| `SPECIAL_5TIET_MAMONS` | Danh sách mã môn có buổi học 5 tiết (LT-only), cách nhau bằng dấu phẩy |

> **Tuyệt đối không commit file `.env.local` lên GitHub.**

---

## Chạy dự án

### Môi trường phát triển

```bash
npm run dev          # Node.js với --watch (tự restart khi thay đổi file)
# Server chạy tại http://localhost:3000
```

### Môi trường production

```bash
npm start
```

### Docker

```bash
npm run docker:build    # Build image
npm run docker:up       # Khởi động container (chạy nền)
npm run docker:logs     # Xem log realtime
npm run docker:down     # Dừng container
npm run docker:rebuild  # Dừng → build lại → khởi động
```

Docker image mở cổng **7860** (tương thích Hugging Face Spaces). Ghi đè bằng `-e PORT=3000` khi chạy local.

### Script seed dữ liệu

```bash
npm run seed:khung              # Seed bảng khung_thoi_gian
npm run seed:khung:dry          # Chạy thử — xem trước không ghi
npm run seed:assignments        # Seed bảng phan_cong_giang_day
npm run seed:assignments:dry    # Chạy thử — xem trước không ghi
npm run seed:all                # Chạy cả 2 script tuần tự
```

---

## Cấu trúc dự án

```
├── server.js                    Backend Express — REST API + điều phối GA
├── ga_cli.py                    Đầu vào Python (stdin JSON → stdout JSON)
├── genetic_algorithm.py         Lớp Individual, vòng lặp GA, crossover, mutation
├── costs.py                     Hàm fitness — ràng buộc cứng & mềm
├── helpers.py                   Khởi tạo quần thể, helper mutation
├── model.py                     Data model (Class, Classroom, Data)
├── utils.py                     Hằng số, nạp dữ liệu
├── scripts/
│   ├── bootstrap_time_slots.js      Seed khung_thoi_gian
│   └── bootstrap_assignments.js     Seed phan_cong_giang_day
├── tkb_viewer.html              Xem thời khóa biểu + kích hoạt sinh TKB
├── index.html                   Quản lý Giảng Viên (CRUD)
├── lop.html                     Quản lý Lớp Học (CRUD)
├── monhoc.html                  Quản lý Môn Học (CRUD)
├── phonghoc.html                Quản lý Phòng Học (CRUD)
├── sidebar.js                   Component điều hướng dùng chung
├── style.css                    CSS toàn cục
├── Dockerfile
└── docker-compose.yml
```

**Bảng Supabase chính:**

| Bảng | Mô tả |
|---|---|
| `giang_vien` | GV: mã, tên, học vị, chuyên môn, loại, trạng thái, ngày/buổi rảnh |
| `gv_blackout_slots` | Buổi bận cố định của GV: `magv`, `ngay` (INT 2–7), `buoi` (sang/chieu/ca_hai) |
| `lop` | Lớp học |
| `mon_hoc` | Môn học: số tiết LT/TH, loại phòng |
| `phong_hoc` | Phòng học: loại (LT/TH), trạng thái |
| `phan_cong_giang_day` | Phân công: GV × lớp × môn, số buổi/tuần, số tiết/buổi |
| `khung_thoi_gian` | Khung giờ dạy được phép (active/inactive theo tuần) |
| `thoi_khoa_bieu` | Kết quả TKB đã sinh |

---

## Kết quả

Kết quả thực nghiệm trên bộ dữ liệu một học kỳ với ~30 buổi học/tuần, 5 phòng (3 LT + 2 TH):

| Chỉ số | Giá trị |
|---|---|
| Vi phạm ràng buộc cứng (H1–H4) | **0** (thỏa mãn 100%) |
| Số thế hệ để đạt `hard = 0` | ~120 – 280 (tùy lần chạy) |
| Thời gian chạy trung bình | ~8 – 15 giây |
| Tiết trống trung bình của sinh viên/ngày | ≤ 2.5 |
| Tiết trống trung bình của giảng viên/ngày | ≤ 1.0 |

Điều kiện dừng sớm (`fitness = 0`) được kích hoạt trong phần lớn các lần chạy trước khi hết 500 thế hệ, cho thấy khởi tạo heuristic và đột biến thông minh giúp tăng tốc đáng kể quá trình hội tụ.

---

## Tài liệu tham khảo

- **Nguồn cảm hứng thuật toán:** [NDresevic/timetable-generator](https://github.com/NDresevic/timetable-generator) — Hệ thống xếp TKB dùng chiến lược tiến hóa (1+1) và simulated annealing (Đại học Belgrade, Khoa Tin học)
- Goldberg, D. E. (1989). *Genetic Algorithms in Search, Optimization, and Machine Learning*. Addison-Wesley.
- Deb, K. (2001). *Multi-Objective Optimization Using Evolutionary Algorithms*. Wiley.
- Even, S., Itai, A., & Shamir, A. (1976). On the Complexity of Timetable and Multicommodity Flow Problems. *SIAM Journal on Computing*, 5(4), 691–703.

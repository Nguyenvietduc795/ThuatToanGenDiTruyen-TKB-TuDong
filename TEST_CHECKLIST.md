# TKB GA Test Checklist

Muc tieu: test ca flow "dep" va cac case co y gay loi, dac biet la tao trung lop-mon-hoc ky, doi khoa sau khi da tao TKB, hoc ky chua co du lieu, fitness/bieu do, va cac man hinh xem lich.

Nguyen tac khi test:
- Khong chi test case thanh cong lan dau.
- Phai co tinh tao lai du lieu da tao de bat loi tao trung.
- Phai test doi khoa DH sau khi mot khoa da tao xong.
- Phai test HK2/HK3 khi chua co du lieu.
- Khi gap bug, chup anh ngay.
- Bug logic tao TKB phai ghi ro lop, mon, hoc ky da chon.
- Bug fitness phai ghi ro pham vi chay, so lop, so buoi, total cost/fitness, hard cost, soft cost.
- Bug UI phai chup anh truoc/sau hoac khoanh vung loi.

## Vai Tro 1: UI/UX Tester

### 1. Flow Tao TKB Lan Dau
- [ ] Chon hoc ky dang mo trong dropdown Hoc ky.
- [ ] Chon 1 lop bat ky.
- [ ] Kiem tra buoc "Chon mon" hien danh sach mon dung voi lop/hoc ky.
- [ ] Tick 1 hoac nhieu mon.
- [ ] Bam "Tao Thoi Khoa Bieu".
- [ ] Kiem tra thong bao thanh cong co so lop-mon moi va so lop-mon bo qua.
- [ ] Kiem tra card "Ket qua lan chay GA gan nhat" hien summary moi neu GA co chay.
- [ ] Kiem tra man hinh lich tu dong reload.

Lien quan:
- UI file: `tkb_viewer.html`
- Ham: `loadHocKyOptions`, `onLopCheckChange`, `loadAvailableMonsForSelectedLops`, `renderMonList`, `generateTKB`, `renderGAResult`
- API: `GET /api/hocky`, `POST /api/ga/available-subjects`, `POST /api/ga/generate`, `GET /api/tkb/viewer`

### 2. Tao Lai Lop/Mon Da Xep
- [ ] Tao TKB thanh cong cho 1 lop + 1 mon.
- [ ] Chon lai dung lop + mon + hoc ky do.
- [ ] Kiem tra mon van hien trong danh sach.
- [ ] Kiem tra status mon: "Da xep cho tat ca lop da chon".
- [ ] Tick mon do va bam tao lai.
- [ ] Kiem tra UI bao: "Tat ca mon/lop da duoc xep trong hoc ky nay. Khong co du lieu moi de tao."
- [ ] Kiem tra khong cap nhat fitness/bieu do nhu lan chay moi.

Lien quan:
- UI file: `tkb_viewer.html`
- Ham: `renderMonList`, `generateTKB`
- API: `POST /api/ga/available-subjects`, `POST /api/ga/generate`

### 3. Tao Khoa Nay Xong Roi Chuyen Sang Khoa Khac
- [ ] Chon khoa DH22, tao TKB cho mot mon.
- [ ] Sau khi tao xong, chon khoa DH25.
- [ ] Kiem tra mon vua tao cho DH22 van hien cho DH25 neu DH25 chua co.
- [ ] Kiem tra status tach dung theo lop dang chon, khong khoa mon toan he thong.
- [ ] Tao TKB cho DH25 va kiem tra thong bao generated/skipped dung.

Lien quan:
- UI file: `tkb_viewer.html`
- Ham: `selectKhoa`, `onLopCheckChange`, `renderMonList`, `generateTKB`
- API: `POST /api/ga/available-subjects`, `POST /api/ga/generate`

### 4. Chon ALL Lop/Khoa
- [ ] Chon "Tat ca" lop.
- [ ] Kiem tra danh sach mon khong bi rong neu hoc ky co du lieu.
- [ ] Kiem tra moi mon co thong tin tong so lop, da xep, chua xep.
- [ ] Bam "Tat ca" mon.
- [ ] Tao TKB va kiem tra thong bao generated/skipped co y nghia.
- [ ] Neu co nhieu du lieu, kiem tra layout khong vo khung.

Lien quan:
- UI file: `tkb_viewer.html`
- Ham: `selectAllLop`, `selectAllMon`, `renderMonList`, `generateTKB`

### 5. HK2/HK3 Chua Co Du Lieu
- [ ] Chon HK2 hoac HK3.
- [ ] Chon mot lop/khoa.
- [ ] Kiem tra buoc "Chon mon" khong hien mon neu hoc ky khong co phan cong.
- [ ] Kiem tra message ro: "Hoc ky nay chua co du lieu mon/phan cong de tao thoi khoa bieu."
- [ ] Khong chap nhan message chung chung neu thuc te la hoc ky chua co data.

Lien quan:
- UI file: `tkb_viewer.html`
- API: `POST /api/ga/available-subjects`
- Seed data: `scripts/bootstrap_assignments.js` chi chon hoc ky dang mo/hoac hoc ky dau tien. Can xac minh neu can seed HK2/HK3.

### 6. Fitness Va Bieu Do Hoi Tu
- [ ] Sau khi tao moi co GA chay, kiem tra Total cost/Fitness, Hard cost, Soft cost, The he, Thoi gian chay.
- [ ] Kiem tra bieu do hoi tu co duong line va diem theo generation.
- [ ] Doi che do "Toan bo" va "50 the he dau".
- [ ] Tao lai case khong co du lieu moi; fitness/bieu do khong duoc cap nhat nhu lan chay moi.
- [ ] Bug fitness phai ghi ro pham vi chay, so lop, so buoi, cost.

Lien quan:
- UI file: `tkb_viewer.html`
- Ham: `renderGASummary`, `renderGAChart`, `renderGAChartStats`, `renderGAResult`, `renderGAMeta`
- API: `POST /api/ga/generate`

### 7. Metadata Pham Vi Chay
- [ ] Tao TKB cho 1 lop, kiem tra metadata hien 1 lop.
- [ ] Tao TKB cho 1 khoa, kiem tra metadata hien dung khoa/pham vi.
- [ ] Tao TKB cho All, kiem tra metadata khong gay hieu nham voi ket qua cu.

Lien quan:
- UI file: `tkb_viewer.html`
- Ham: `buildRunMeta`, `renderGAMeta`

### 8. Lich Theo Lop
- [ ] Sau khi tao TKB, vao tab Sinh vien.
- [ ] Chon lop vua tao.
- [ ] Kiem tra lich hien dung mon, phong, giang vien, tiet hoc.
- [ ] Kiem tra LT/TH co badge va mau dung.

Lien quan:
- UI file: `tkb_viewer.html`
- Ham: `renderSV`, `buildGrid`, `card`
- API: `GET /api/tkb/viewer`

### 9. Lich Theo Giang Vien
- [ ] Vao tab Giang vien.
- [ ] Chon giang vien co lich.
- [ ] Kiem tra cac buoi day hien dung lop/mon/phong.
- [ ] Kiem tra neu giang vien khong co lich thi UI khong bi loi.

Lien quan:
- UI file: `tkb_viewer.html`
- Ham: `renderGV`, `buildGrid`, `card`
- API: `GET /api/tkb/viewer`

### 10. Lich Theo Phong
- [ ] Vao tab Phong hoc.
- [ ] Chon ngay trong tuan.
- [ ] Kiem tra phong co lich va phong trong.
- [ ] Kiem tra thong ke phong trong/dang dung.

Lien quan:
- UI file: `tkb_viewer.html`
- Ham: `renderRoomGrid`, `buildRoomGrid`, `buildRoomStats`
- API: `GET /api/tkb/viewer`

### 11. Mau LT/TH/Trong
- [ ] Kiem tra LT co mau/badge LT.
- [ ] Kiem tra TH co mau/badge TH.
- [ ] Kiem tra o trong hien "TRONG" va khong nham voi lop dang hoc.
- [ ] Kiem tra chu khong tran/chen nhau khi ten mon dai.

Lien quan:
- UI file: `tkb_viewer.html`
- Ham: `card`, `buildRoomGrid`, `buildLegend`

### 12. Hoan Lich/Hoc Bu
- [ ] Tam ngung mot buoi hoc.
- [ ] Tao hoc bu cho buoi tam ngung.
- [ ] Kiem tra slot hoc bu chi cho chon khi giang vien/lop/phong hop le.
- [ ] Kiem tra hoc bu hien badge/trang thai dung tren lich.
- [ ] Can xac minh day du business rule hoc bu voi PO/BE neu co thay doi yeu cau.

Lien quan:
- UI file: `tkb_viewer.html`
- Ham: `pauseSession`, `openMakeupModal`, `loadAvailableMakeupSlots`, `submitMakeup`
- API: `POST /api/tkb/:matkb/tam-ngung`, `POST /api/tkb/:matkb/available-makeup-slots`, `POST /api/tkb/:matkb/tao-hoc-bu`, `PUT /api/tkb/:matkb_hocbu`, `POST /api/tkb/check-slot`

### 13. Thong Bao Loi/Thanh Cong
- [ ] Tao thanh cong lan dau: message co generated/skipped ro rang.
- [ ] Tao lai toan bo da co: message la no-new-data, khong bao GA thanh cong moi.
- [ ] Hoc ky chua co data: message ro hoc ky chua co data.
- [ ] Loi API/network: UI hien loi de user biet.

Lien quan:
- UI file: `tkb_viewer.html`
- Ham: `showResult`, `generateTKB`, `renderMonList`

### 14. Responsive/Layout
- [ ] Test man hinh laptop nho.
- [ ] Test trinh duyet zoom 125% va 150%.
- [ ] Test danh sach lop/mon dai.
- [ ] Test ten mon dai, ten lop dai, nhieu phong.
- [ ] Chup anh neu co overlap, tran chu, scroll kho dung.

Lien quan:
- UI file: `tkb_viewer.html`
- CSS trong `<style>` cua file.

## Vai Tro 2: AI/BE Logic Tester

### 1. API Load Mon Theo Lop/Hoc Ky
- [ ] Goi `POST /api/ga/available-subjects` voi `malops` va `mahk`.
- [ ] Kiem tra moi mon co `total_classes`, `created_count`, `pending_count`, `created_classes`, `pending_classes`, `status_label`, `selectable`.
- [ ] Kiem tra status dua tren khoa `mahk + malop + mamon`, khong dua tren `mamon` toan he thong.
- [ ] Kiem tra mon da co `phan_cong_giang_day` duoc tinh la created cho lop do.
- [ ] Kiem tra neu hoc ky khong co phan cong thi response `data: []` va co message ro.

Lien quan:
- BE file: `server.js`
- API: `POST /api/ga/available-subjects`
- Ham/logic: code trong route `/api/ga/available-subjects`

### 2. Chan Tao Trung Khi Bam Tao TKB
- [ ] Tao truoc 1 cap `mahk + malop + mamon`.
- [ ] Goi `POST /api/ga/generate` lai voi cap do.
- [ ] Kiem tra backend khong tao `mapc` moi.
- [ ] Kiem tra response `status: NO_NEW_ASSIGNMENTS` neu khong co cap moi.
- [ ] Kiem tra `summary.generated_count = 0`, `summary.skipped_count = skipped.length`.
- [ ] Kiem tra Python GA khong chay khi khong co cap moi.

Lien quan:
- BE file: `server.js`
- API: `POST /api/ga/generate`
- Ham: `prepareGaAssignmentsForSelectionV2`

### 3. Mixed Generated/Skipped
- [ ] Chon 5 lop + 1 mon, trong do 3 cap da co `phan_cong_giang_day`, 2 cap chua co.
- [ ] Goi tao TKB.
- [ ] Kiem tra `skipped_count = 3`, `generated_count = 2`.
- [ ] Kiem tra chi 2 cap moi duoc insert vao `phan_cong_giang_day`.
- [ ] Kiem tra GA chi chay tren scope du lieu can tao moi.

Lien quan:
- BE file: `server.js`
- API: `POST /api/ga/generate`
- Ham: `prepareGaAssignmentsForSelectionV2`

### 4. Mahk Isolation
- [ ] Tao `DH22TIN01 + AI + HK1`.
- [ ] Test `DH22TIN01 + AI + HK2`.
- [ ] Neu HK2 co data, phai duoc xem doc lap voi HK1.
- [ ] Neu HK2 khong co data, phai bao hoc ky chua co du lieu.
- [ ] Kiem tra khong check duplicate sai hoc ky.

Lien quan:
- BE file: `server.js`
- API: `POST /api/ga/available-subjects`, `POST /api/ga/generate`
- Can xac minh: data seed HK2/HK3 co ton tai hay khong.

### 5. Fitness/History From Backend
- [ ] Kiem tra `run_ga_with_raw` tra `summary`, `history`, `breakdown`.
- [ ] Kiem tra frontend chi render GA result khi response tao co `generated_count > 0`.
- [ ] Kiem tra no-new-assignment khong ghi localStorage GA result moi.

Lien quan:
- BE file: `genetic_algorithm.py`, `server.js`
- FE file: `tkb_viewer.html`
- Ham: `run_ga_with_raw`, `generateTKB`, `saveGAResult`, `renderGAResult`

### 6. TKB Viewer Data
- [ ] Goi `GET /api/tkb/viewer?tuanhoc=...&mahk=...`.
- [ ] Kiem tra response co danh sach lich, gv, lop, phong, mon, khung.
- [ ] Kiem tra filter hoc ky khong lam mat du lieu ngoai y muon.

Lien quan:
- BE file: `server.js`
- API: `GET /api/tkb/viewer`
- UI ham: `loadViewData`

### 7. Hoc Bu/Hoan Lich
- [ ] Kiem tra API check slot khong cho trung giang vien/lop/phong.
- [ ] Kiem tra tam ngung khong xoa mat lich goc ngoai y muon.
- [ ] Kiem tra hoc bu co link ve `tkb_goc_id` neu source dang dung.
- [ ] Can xac minh them business rule hoc bu voi yeu cau san pham.

Lien quan:
- BE file: `server.js`
- API: `POST /api/tkb/check-slot`, `POST /api/tkb/:matkb/available-makeup-slots`, `POST /api/tkb/:matkb/tam-ngung`, `POST /api/tkb/:matkb/tao-hoc-bu`, `PUT /api/tkb/:matkb_hocbu`

## Bug Report Template

```md
## Bug title

- Nguoi test:
- Vai tro test: UI/UX tester | AI/BE logic tester
- Branch:
- Browser:
- Ngay test:
- Muc do: Critical | High | Medium | Low

### Buoc tai hien
1.
2.
3.

### Ket qua hien tai

### Ket qua mong muon

### Anh/video minh chung

### Du lieu lien quan
- Lop:
- Mon:
- Hoc ky:
- Pham vi chay:
- So lop:
- So buoi:
- Cost/Fitness:
```

## Muc Can Xac Minh Them

- Can xac minh seed data HK2/HK3: `scripts/bootstrap_assignments.js` hien chon hoc ky dang mo hoac hoc ky dau tien, chua thay logic seed rieng HK2/HK3.
- Can xac minh business rule hoc bu chi tiet voi PO/BE neu co yeu cau ngoai cac API hien co.
- Can xac minh chuan hien thi tieng Viet neu moi truong dang bi loi encoding trong mot so text hien tai.

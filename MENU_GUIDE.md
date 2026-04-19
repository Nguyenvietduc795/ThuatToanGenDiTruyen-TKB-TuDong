# Hướng Dẫn Nhúng Menu Vào HTML

## 📋 Các Phương Pháp Nhúng Menu

### **Phương Pháp 1: Sử dụng JavaScript Fetch (Khuyên Dùng)**

Thêm đoạn code này vào **đầu thẻ `<body>`** của mỗi file HTML:

```html
<body>
    <div id="menu-container"></div>
    <script>
        // Load menu từ menu.html
        fetch('menu.html')
            .then(response => response.text())
            .then(html => {
                document.getElementById('menu-container').innerHTML = html;
            })
            .catch(error => console.error('Không thể tải menu:', error));
    </script>
    
    <!-- Nội dung trang của bạn -->
    <div class="container" style="max-width: 1200px;">
        <!-- ... -->
    </div>
</body>
```

**Ưu điểm:**
- ✅ Menu tự động cập nhật ở tất cả trang
- ✅ Chỉ cần thay đổi menu.html là tất cả trang đều thay đổi
- ✅ DRY principle (Don't Repeat Yourself)

---

### **Phương Pháp 2: Copy-Paste Trực Tiếp**

Mở file `menu.html`, copy toàn bộ nội dung (bao gồm `<nav>` và `<style>`, `<script>`), rồi paste vào **đầu file `<body>`** của mỗi HTML:

```html
<body>
    <!-- PASTE NỘI DUNG MENU.HTML TẠI ĐÂY -->
    
    <div class="container" style="max-width: 1200px;">
        <!-- Nội dung trang -->
    </div>
</body>
```

**Ưu điểm:**
- ✅ Không phụ thuộc vào fetch
- ✅ Hoạt động offline

**Nhược điểm:**
- ❌ Phải cập nhật thủ công ở mỗi trang nếu thay đổi menu

---

## 📝 Ví Dụ Cụ Thể

### Thêm menu vào `monhoc.html`:

```html
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Quản Lý Môn Học - DNC</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <!-- THÊM MENU TẠI ĐÂY -->
    <div id="menu-container"></div>
    <script>
        fetch('menu.html')
            .then(response => response.text())
            .then(html => {
                document.getElementById('menu-container').innerHTML = html;
            });
    </script>
    
    <!-- Nội dung ban đầu -->
    <div class="container" style="max-width: 1200px;">
        <header>
            <h1>DANH MỤC MÔN HỌC</h1>
        </header>
        
        <!-- ... phần còn lại của trang ... -->
    </div>
</body>
</html>
```

---

## 🎨 Tùy Chỉnh Menu

### Đổi màu menu:

Tìm phần `linear-gradient(135deg, #667eea 0%, #764ba2 100%)` trong style và thay đổi:

```css
/* Xanh dương */
background: linear-gradient(135deg, #3b82f6 0%, #1e40af 100%);

/* Xanh lá */
background: linear-gradient(135deg, #10b981 0%, #059669 100%);

/* Đỏ */
background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
```

### Thêm trang mới vào menu:

Thêm dòng này vào phần `<ul class="navbar-menu">`:

```html
<li class="nav-item">
    <a href="trang-moi.html" class="nav-link">
        <span class="nav-icon">🆕</span>
        <span>Trang Mới</span>
    </a>
</li>
```

---

## ✨ Tính Năng Menu

- 📱 **Responsive**: Tự động thích ứng với màn hình nhỏ
- 🎯 **Active State**: Tự động đánh dấu trang hiện tại
- 🎨 **Modern Design**: Gradient colors, smooth animations
- 📱 **Mobile Menu**: Dropdown menu cho điện thoại
- ⌨️ **Keyboard Friendly**: Hỗ trợ tab navigation

---

## 🚀 Áp Dụng Ngay

1. **Lưu menu.html** (đã tạo)
2. **Thêm `<div id="menu-container"></div>` + fetch script** vào đầu `<body>` của:
   - `monhoc.html`
   - `lop.html`
   - `phonghoc.html`
   - `index.html`

Xong! Menu sẽ tự động xuất hiện trên tất cả các trang. 🎉

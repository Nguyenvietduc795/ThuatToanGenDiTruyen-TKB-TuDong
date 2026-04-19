(function () {
  const NAV = [
    { file: 'tkb_viewer.html', href: '/tkb_viewer.html', icon: '📅', label: 'Thời Khóa Biểu' },
    { file: 'index.html',      href: '/index.html',      icon: '👨‍🏫', label: 'Giảng Viên' },
    { file: 'lop.html',        href: '/lop.html',        icon: '🎓',  label: 'Lớp Học' },
    { file: 'monhoc.html',     href: '/monhoc.html',     icon: '📚',  label: 'Môn Học' },
    { file: 'phonghoc.html',   href: '/phonghoc.html',   icon: '🏛',  label: 'Phòng Học' },
  ];

  const path = window.location.pathname;
  function isActive(file) {
    if (file === 'index.html') return /\/$|\/index\.html$/.test(path);
    return path.includes(file.replace('.html', ''));
  }

  const style = document.createElement('style');
  style.textContent = `
    #app-sidebar {
      position: fixed; left: 0; top: 0; bottom: 0; width: 210px;
      background: linear-gradient(180deg, #0f172a 0%, #1e293b 100%);
      z-index: 9000; display: flex; flex-direction: column;
      box-shadow: 3px 0 12px rgba(0,0,0,.3); overflow: hidden;
    }
    #app-sidebar .sb-logo {
      padding: 18px 16px 14px;
      color: #f8fafc; font-size: 15px; font-weight: 800;
      border-bottom: 1px solid #334155; letter-spacing: .4px;
      display: flex; align-items: center; gap: 8px;
    }
    #app-sidebar .sb-logo span { font-size: 22px; }
    #app-sidebar .sb-section { font-size: 10px; color: #64748b;
      padding: 12px 16px 4px; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; }
    #app-sidebar a {
      display: flex; align-items: center; gap: 10px;
      padding: 11px 16px; color: #94a3b8; text-decoration: none;
      font-size: 13.5px; font-weight: 500; transition: all .15s;
      border-left: 3px solid transparent;
    }
    #app-sidebar a:hover { background: rgba(255,255,255,.06); color: #e2e8f0; }
    #app-sidebar a.sb-active {
      background: rgba(59,130,246,.15); color: #93c5fd;
      border-left-color: #3b82f6; font-weight: 700;
    }
    #app-sidebar .sb-icon { font-size: 17px; line-height: 1; }
    #app-sidebar .sb-footer {
      margin-top: auto; padding: 12px 16px;
      border-top: 1px solid #334155;
      font-size: 11px; color: #475569; text-align: center;
    }
    body { margin-left: 210px !important; }
  `;
  document.head.appendChild(style);

  const sb = document.createElement('nav');
  sb.id = 'app-sidebar';
  sb.innerHTML = `
    <div class="sb-logo"><span>📆</span>TKB Hệ Thống</div>
    <div class="sb-section">Điều hướng</div>
    ${NAV.map(n => `
      <a href="${n.href}" class="${isActive(n.file) ? 'sb-active' : ''}">
        <span class="sb-icon">${n.icon}</span>${n.label}
      </a>
    `).join('')}
    <div class="sb-footer">Khoa CNTT &copy; 2025</div>
  `;
  document.body.insertBefore(sb, document.body.firstChild);
})();

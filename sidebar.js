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
      position: fixed; left: 0; top: 0; bottom: 0; width: 220px;
      background: linear-gradient(180deg, #0f172a 0%, #172036 100%);
      z-index: 9000; display: flex; flex-direction: column;
      box-shadow: 4px 0 18px rgba(0,0,0,.28); overflow: hidden;
    }
    #app-sidebar .sb-logo {
      padding: 20px 18px 17px;
      color: #f1f5f9; font-size: 15.5px; font-weight: 800;
      border-bottom: 1px solid rgba(255,255,255,0.07);
      letter-spacing: .3px;
      display: flex; align-items: center; gap: 10px;
    }
    #app-sidebar .sb-logo span { font-size: 24px; }
    #app-sidebar .sb-section {
      font-size: 10px; color: #475569;
      padding: 14px 18px 5px;
      text-transform: uppercase; letter-spacing: 1.2px; font-weight: 700;
    }
    #app-sidebar a {
      display: flex; align-items: center; gap: 11px;
      padding: 13px 20px; color: #94a3b8; text-decoration: none;
      font-size: 13.5px; font-weight: 500; transition: all .15s;
      border-left: 4px solid transparent; margin: 1px 0;
    }
    #app-sidebar a:hover {
      background: rgba(255,255,255,.07); color: #e2e8f0;
    }
    #app-sidebar a.sb-active {
      background: rgba(30,58,138,.45); color: #bfdbfe;
      border-left-color: #60a5fa; font-weight: 700;
    }
    #app-sidebar .sb-icon { font-size: 18px; line-height: 1; }
    #app-sidebar .sb-footer {
      margin-top: auto; padding: 14px 18px;
      border-top: 1px solid rgba(255,255,255,0.06);
      font-size: 11px; color: #475569; text-align: center;
    }
    body { margin-left: 220px !important; }
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

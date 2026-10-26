// TIS Paper Repository - Complete Application Logic with Clickable Tabs & Full Admin Teacher Management

const API_BASE = '/api';
const TOKEN_KEY = 'tis_repo_token';
const USER_KEY = 'tis_repo_user';
const THEME_KEY = 'tis_theme';

// State
let currentUser = null;
let currentToken = null;
let papersList = [];
let papersFetchId = 0;
let teachersList = [];
let classYears = [];
let lastStats = null;
const DEFAULT_CLASS_YEARS = ['Year 7', 'Year 8', 'Year 9', 'Year 10', 'Year 11', 'Year 12', 'Year 13'];
let activeDashboardTab = 'papers'; // 'papers', 'dashboard' or 'admin'
let viewMode = 'list'; // 'grid' or 'list'
let searchDebounceTimer = null;
let mobileSidebarOpen = false;
let pendingDeletePaperId = null;
let pendingDeleteTeacherId = null;
let teacherPapersCache = [];
let previewPaper = null;
let previewObjectUrl = null;

// Initial setup
document.addEventListener('DOMContentLoaded', () => {
  currentToken = localStorage.getItem(TOKEN_KEY);
  const savedUser = localStorage.getItem(USER_KEY);
  if (savedUser) {
    try {
      currentUser = JSON.parse(savedUser);
    } catch (e) {
      currentUser = null;
    }
  }

  if (currentToken && currentUser) {
    refreshCurrentUser().then(() => {
      showAppView();
    }).catch(() => {
      showLoginView();
    });
  } else {
    showLoginView();
  }

  setupEventListeners();
  restoreLoginPreferences();
  applyTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light', { persist: false, refreshCharts: false });
  if (window.lucide) lucide.createIcons();
});

// Refresh user permissions
async function refreshCurrentUser() {
  if (!currentToken) return;
  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: { 'Authorization': `Bearer ${currentToken}` }
  });
  if (res.ok) {
    const data = await res.json();
    currentUser = data.user;
    localStorage.setItem(USER_KEY, JSON.stringify(currentUser));
  } else {
    throw new Error('Session expired');
  }
}

// Event Listeners
function setupEventListeners() {
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
  }

  const dropZone = document.getElementById('dropZone');
  if (dropZone) {
    ['dragenter', 'dragover'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('dragover');
      }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('dragover');
      }, false);
    });

    dropZone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const files = dt.files;
      if (files.length > 0) {
        const fileInput = document.getElementById('fileInput');
        fileInput.files = files;
        handleFileSelected(fileInput);
      }
    });
  }
}

// Mobile Sidebar
function toggleMobileSidebar() {
  const sidebar = document.getElementById('mainSidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  mobileSidebarOpen = !mobileSidebarOpen;

  if (mobileSidebarOpen) {
    sidebar.classList.remove('-translate-x-full');
    backdrop.classList.remove('hidden');
  } else {
    sidebar.classList.add('-translate-x-full');
    backdrop.classList.add('hidden');
  }
}

// Clickable sidebar section collapse/expand toggle
function toggleSidebarSection(navId) {
  const nav = document.getElementById(navId);
  const arrow = document.getElementById('arrow_' + navId);
  if (!nav) return;

  if (nav.classList.contains('hidden')) {
    nav.classList.remove('hidden');
    if (arrow) arrow.style.transform = 'rotate(0deg)';
  } else {
    nav.classList.add('hidden');
    if (arrow) arrow.style.transform = 'rotate(-90deg)';
  }
}

// Switch between Main Tabs (Papers Repository, Admin Dashboard, Administration)
function showDashboardTab(tabName) {
  const isAdminUser = !!currentUser && currentUser.role === 'admin';
  if ((tabName === 'admin' || tabName === 'dashboard') && !isAdminUser) {
    tabName = 'papers';
  }
  activeDashboardTab = tabName;
  if (mobileSidebarOpen) toggleMobileSidebar();

  const papersView = document.getElementById('papersMainView');
  const adminView = document.getElementById('adminMainView');
  const dashboardView = document.getElementById('dashboardMainView');
  const navAdminTab = document.getElementById('navAdminTab');
  const navDashboardTab = document.getElementById('navDashboardTab');

  [[papersView, 'papers'], [dashboardView, 'dashboard'], [adminView, 'admin']].forEach(([view, name]) => {
    if (view) view.classList.toggle('hidden', name !== tabName);
  });

  if (navAdminTab) {
    navAdminTab.classList.toggle('ring-2', tabName === 'admin');
    navAdminTab.classList.toggle('ring-school-400', tabName === 'admin');
  }
  if (navDashboardTab) {
    navDashboardTab.classList.toggle('ring-2', tabName === 'dashboard');
    navDashboardTab.classList.toggle('ring-school-400', tabName === 'dashboard');
  }

  if (tabName === 'papers') {
    updateSidebarActiveStyles();
  } else {
    document.querySelectorAll('#navAllPapers, #navBio, #navChem, [id^="navYear_"], [id^="navAcad_"]')
      .forEach(el => el.classList.remove('active'));
  }

  if (tabName === 'admin') {
    loadAdminTeachersTable();
  } else if (tabName === 'dashboard') {
    loadAdminDashboard();
  } else {
    updateBreadcrumbTitle();
    fetchPapers();
  }

  if (window.lucide) lucide.createIcons();
}

// ==================== AUTHENTICATION ====================

const REMEMBERED_USERNAME_KEY = 'tis_remembered_username';

function setLoginPasswordVisible(visible) {
  const input = document.getElementById('loginPassword');
  if (!input) return;
  input.type = visible ? 'text' : 'password';
  const eye = document.getElementById('loginPasswordEye');
  if (eye) eye.setAttribute('data-lucide', visible ? 'eye-off' : 'eye');
  const toggle = document.getElementById('loginPasswordToggle');
  if (toggle) {
    toggle.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
    toggle.title = visible ? 'Hide password' : 'Show password';
  }
  if (window.lucide) lucide.createIcons();
}

function toggleLoginPasswordVisibility() {
  const input = document.getElementById('loginPassword');
  if (!input) return;
  setLoginPasswordVisible(input.type === 'password');
}

function showLoginPasswordHelp() {
  showToast('Contact your administrator to reset your password.', 'info');
}

function restoreLoginPreferences() {
  const usernameInput = document.getElementById('loginUsername');
  const remember = document.getElementById('loginRemember');
  const saved = localStorage.getItem(REMEMBERED_USERNAME_KEY);
  if (usernameInput && saved) usernameInput.value = saved;
  if (remember) remember.checked = Boolean(saved);
}

async function handleLogin(e) {
  e.preventDefault();
  const usernameInput = document.getElementById('loginUsername');
  const passwordInput = document.getElementById('loginPassword');
  const errorDiv = document.getElementById('loginError');
  const errorMsg = document.getElementById('loginErrorMessage');
  const submitBtn = document.getElementById('loginSubmitBtn');

  errorDiv.classList.add('hidden');
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<span>Signing in...</span>`;

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: usernameInput.value.trim(),
        password: passwordInput.value.trim()
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');

    currentToken = data.token;
    currentUser = data.user;
    localStorage.setItem(TOKEN_KEY, currentToken);
    localStorage.setItem(USER_KEY, JSON.stringify(currentUser));

    const remember = document.getElementById('loginRemember');
    if (remember && remember.checked) {
      localStorage.setItem(REMEMBERED_USERNAME_KEY, usernameInput.value.trim());
    } else {
      localStorage.removeItem(REMEMBERED_USERNAME_KEY);
    }

    showAppView();
    showToast(`Signed in as ${getDisplayName(currentUser)}!`, 'success');
  } catch (err) {
    errorDiv.classList.remove('hidden');
    errorMsg.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<span>Sign In</span>`;
    if (window.lucide) lucide.createIcons();
  }
}

function getDisplayName(user) {
  const raw = String((user && (user.name || user.username)) || '').trim();
  return raw
    .replace(/^head of science\s*\/\s*/i, '')
    .replace(/\s*\((?:biology|chemistry)\)\s*$/i, '')
    .trim() || raw;
}

function logout() {
  if (currentToken) {
    fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${currentToken}` }
    }).catch(() => {});
  }
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  currentToken = null;
  currentUser = null;
  showLoginView();
  showToast('Logged out successfully', 'info');
}

function showLoginView() {
  document.getElementById('loginSection').classList.remove('hidden');
  document.getElementById('appSection').classList.add('hidden');

  const passwordInput = document.getElementById('loginPassword');
  if (passwordInput) passwordInput.value = '';
  setLoginPasswordVisible(false);

  const errorDiv = document.getElementById('loginError');
  if (errorDiv) errorDiv.classList.add('hidden');

  restoreLoginPreferences();

  if (window.lucide) lucide.createIcons();
}

// ==================== MY ACCOUNT ====================

let accountPasswordVisible = false;
let changePasswordVisible = false;
const CHANGE_PASSWORD_FIELDS = ['accountCurrentInput', 'accountNewInput', 'accountConfirmInput'];

function setChangePasswordVisibility(visible) {
  changePasswordVisible = visible;
  CHANGE_PASSWORD_FIELDS.forEach(id => {
    const input = document.getElementById(id);
    if (input) input.type = visible ? 'text' : 'password';
  });
  const eye = document.getElementById('changePasswordEye');
  if (eye) eye.setAttribute('data-lucide', visible ? 'eye-off' : 'eye');
  const label = document.getElementById('changePasswordEyeLabel');
  if (label) label.textContent = visible ? 'Hide' : 'Show';
  if (window.lucide) lucide.createIcons();
}

function toggleChangePasswordVisibility() {
  setChangePasswordVisibility(!changePasswordVisible);
}

// ==================== APPEARANCE ====================

function applyTheme(theme, { persist = true, refreshCharts = true } = {}) {
  const isDark = theme === 'dark';
  document.documentElement.classList.toggle('dark', isDark);

  if (persist) {
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  }

  updateThemeToggleUI(isDark);

  const logoPath = isDark ? '/images/cambridge-logo-light.svg' : '/images/cambridge-logo.svg';
  const sidebarLogo = document.getElementById('sidebarLogo');
  if (sidebarLogo) sidebarLogo.src = logoPath;
  const loginLogo = document.getElementById('loginLogo');
  if (loginLogo) loginLogo.src = logoPath;

  if (refreshCharts) {
    if (adminCharts.year) { adminCharts.year.destroy(); adminCharts.year = null; }
    if (adminCharts.class) { adminCharts.class.destroy(); adminCharts.class = null; }
    if (activeDashboardTab === 'dashboard' && currentUser && currentUser.role === 'admin') {
      loadAdminDashboard();
    }
  }
}

function toggleTheme() {
  applyTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark');
}

function updateThemeToggleUI(isDark) {
  const toggle = document.getElementById('themeToggle');
  if (toggle) {
    toggle.setAttribute('aria-checked', String(isDark));
    toggle.classList.toggle('bg-school-700', isDark);
    toggle.classList.toggle('border-school-700', isDark);
    toggle.classList.toggle('bg-slate-200', !isDark);
    toggle.classList.toggle('border-slate-300', !isDark);
  }

  const thumb = document.getElementById('themeToggleThumb');
  if (thumb) {
    thumb.classList.toggle('translate-x-6', isDark);
    thumb.classList.toggle('translate-x-1', !isDark);
  }

  const label = document.getElementById('themeModeLabel');
  if (label) label.textContent = isDark ? 'Dark mode' : 'Light mode';

  const iconWrap = document.getElementById('themeModeIconWrap');
  if (iconWrap) {
    iconWrap.innerHTML = `<i data-lucide="${isDark ? 'moon' : 'sun'}" class="w-5 h-5"></i>`;
  }

  if (window.lucide) lucide.createIcons();
}

function showAccountMenu() {
  const menu = document.getElementById('accountMenuScreen');
  const settings = document.getElementById('accountSettingsScreen');
  if (menu) menu.classList.remove('hidden');
  if (settings) settings.classList.add('hidden');
  const card = document.querySelector('#myAccountModal > div');
  if (card) card.scrollTop = 0;
  if (window.lucide) lucide.createIcons();
}

function showAccountSettings() {
  const menu = document.getElementById('accountMenuScreen');
  const settings = document.getElementById('accountSettingsScreen');
  if (menu) menu.classList.add('hidden');
  if (settings) settings.classList.remove('hidden');
  const card = document.querySelector('#myAccountModal > div');
  if (card) card.scrollTop = 0;
  if (window.lucide) lucide.createIcons();
}

function handleAccountSignOut() {
  closeMyAccountModal();
  logout();
}

function openMyAccountModal() {
  if (!currentUser) return;
  const name = getDisplayName(currentUser);
  document.getElementById('accountAvatarLetter').textContent = name.charAt(0).toUpperCase();
  document.getElementById('accountName').textContent = name;
  document.getElementById('accountUsername').textContent = `@${currentUser.username}`;
  document.getElementById('accountRole').textContent = currentUser.role || '—';

  const subjects = currentUser.assignedSubjects || [];
  document.getElementById('accountSubjects').textContent =
    currentUser.role === 'admin' ? 'All Subjects' : (subjects.length ? subjects.join(', ') : '—');

  const officeEl = document.getElementById('accountMenuOffice');
  if (officeEl) {
    let office = 'Student Member';
    if (currentUser.role === 'admin') office = 'Head Office';
    else if (currentUser.role === 'teacher') office = subjects.length ? `${subjects.join(' & ')} Faculty` : 'Faculty';
    officeEl.textContent = `Office: ${office}`;
  }

  accountPasswordVisible = false;
  renderAccountPassword();

  document.getElementById('editProfileForm').reset();
  document.getElementById('accountNameInput').value = name;
  document.getElementById('accountUsernameInput').value = currentUser.username || '';
  document.getElementById('accountProfileError').classList.add('hidden');
  document.getElementById('accountProfileSuccess').classList.add('hidden');

  document.getElementById('changePasswordForm').reset();
  document.getElementById('accountPasswordError').classList.add('hidden');
  document.getElementById('accountPasswordSuccess').classList.add('hidden');
  setChangePasswordVisibility(false);

  showAccountMenu();
  updateThemeToggleUI(document.documentElement.classList.contains('dark'));
  document.getElementById('myAccountModal').classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function closeMyAccountModal() {
  document.getElementById('myAccountModal').classList.add('hidden');
  document.getElementById('editProfileForm').reset();
  document.getElementById('accountProfileError').classList.add('hidden');
  document.getElementById('accountProfileSuccess').classList.add('hidden');
  document.getElementById('changePasswordForm').reset();
  document.getElementById('accountPasswordError').classList.add('hidden');
  document.getElementById('accountPasswordSuccess').classList.add('hidden');
  setChangePasswordVisibility(false);
  showAccountMenu();
}

function updateUserDisplay() {
  if (!currentUser) return;
  const name = getDisplayName(currentUser);
  document.getElementById('navUserName').textContent = name;
  document.getElementById('userAvatarLetter').textContent = name.charAt(0).toUpperCase();
  document.getElementById('accountName').textContent = name;
  document.getElementById('accountAvatarLetter').textContent = name.charAt(0).toUpperCase();
  document.getElementById('accountUsername').textContent = `@${currentUser.username}`;
}

async function handleUpdateProfileSubmit(e) {
  e.preventDefault();
  if (!currentToken) return;

  const nameInput = document.getElementById('accountNameInput');
  const errorBox = document.getElementById('accountProfileError');
  const errorText = document.getElementById('accountProfileErrorText');
  const successBox = document.getElementById('accountProfileSuccess');
  const submitBtn = document.getElementById('editProfileSubmitBtn');

  errorBox.classList.add('hidden');
  successBox.classList.add('hidden');

  const name = nameInput.value.trim();
  if (!name) {
    errorBox.classList.remove('hidden');
    errorText.textContent = 'Full name is required.';
    return;
  }

  submitBtn.disabled = true;
  const originalBtn = submitBtn.innerHTML;
  submitBtn.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin"></i><span>Saving...</span>';
  if (window.lucide) lucide.createIcons();

  try {
    const res = await fetch(`${API_BASE}/auth/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ name })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not update profile');

    currentUser.name = data.user.name;
    localStorage.setItem(USER_KEY, JSON.stringify(currentUser));
    updateUserDisplay();
    successBox.classList.remove('hidden');
    showToast('Profile updated successfully', 'success');
  } catch (err) {
    errorBox.classList.remove('hidden');
    errorText.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalBtn;
    if (window.lucide) lucide.createIcons();
  }
}

function renderAccountPassword() {
  const el = document.getElementById('accountCurrentPassword');
  const eye = document.getElementById('accountPasswordEye');
  const value = (currentUser && currentUser.plainTextNotice) || '—';
  el.textContent = accountPasswordVisible ? value : '••••••';
  if (eye) eye.setAttribute('data-lucide', accountPasswordVisible ? 'eye-off' : 'eye');
  if (window.lucide) lucide.createIcons();
}

function toggleAccountPasswordVisibility() {
  accountPasswordVisible = !accountPasswordVisible;
  renderAccountPassword();
}

async function handleChangePasswordSubmit(e) {
  e.preventDefault();
  if (!currentToken) return;

  const currentInput = document.getElementById('accountCurrentInput');
  const newInput = document.getElementById('accountNewInput');
  const confirmInput = document.getElementById('accountConfirmInput');
  const errorBox = document.getElementById('accountPasswordError');
  const errorText = document.getElementById('accountPasswordErrorText');
  const successBox = document.getElementById('accountPasswordSuccess');
  const submitBtn = document.getElementById('changePasswordSubmitBtn');

  errorBox.classList.add('hidden');
  successBox.classList.add('hidden');

  if (newInput.value.trim() !== confirmInput.value.trim()) {
    errorBox.classList.remove('hidden');
    errorText.textContent = 'New password and confirmation do not match.';
    return;
  }

  submitBtn.disabled = true;
  const originalBtn = submitBtn.innerHTML;
  submitBtn.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin"></i><span>Updating...</span>';
  if (window.lucide) lucide.createIcons();

  try {
    const res = await fetch(`${API_BASE}/auth/password`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({
        currentPassword: currentInput.value.trim(),
        newPassword: newInput.value.trim()
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not update password');

    currentUser.plainTextNotice = newInput.value.trim();
    localStorage.setItem(USER_KEY, JSON.stringify(currentUser));

    document.getElementById('changePasswordForm').reset();
    accountPasswordVisible = false;
    renderAccountPassword();
    setChangePasswordVisibility(false);
    successBox.classList.remove('hidden');
    showToast('Password updated successfully', 'success');
  } catch (err) {
    errorBox.classList.remove('hidden');
    errorText.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalBtn;
    if (window.lucide) lucide.createIcons();
  }
}

function showAppView() {
  document.getElementById('loginSection').classList.add('hidden');
  document.getElementById('appSection').classList.remove('hidden');

  document.getElementById('filterClass').value = 'all';
  document.getElementById('filterAcademicYear').value = 'all';
  document.getElementById('filterTerm').value = 'all';
  document.getElementById('searchInput').value = '';
  setViewMode('list', false);

  const name = getDisplayName(currentUser);
  document.getElementById('navUserName').textContent = name;
  document.getElementById('userAvatarLetter').textContent = name.charAt(0).toUpperCase();
  
  const subjects = currentUser.assignedSubjects || [];
  const isAdmin = currentUser.role === 'admin';
  const isTeacher = currentUser.role === 'teacher';

  const scopeEl = document.getElementById('navUserScope');
  if (isAdmin) {
    scopeEl.textContent = 'Administrator';
    scopeEl.className = 'text-[10px] text-purple-300 font-bold truncate';
  } else if (subjects.length === 1) {
    scopeEl.textContent = `${subjects[0]} Faculty`;
    scopeEl.className = 'text-[10px] text-emerald-300 font-bold truncate';
  } else {
    scopeEl.textContent = `${currentUser.role.toUpperCase()} • All Subjects`;
    scopeEl.className = 'text-[10px] text-slate-300 font-medium truncate';
  }

  // Admin controls visibility
  const adminSection = document.getElementById('sideAdminSection');
  if (isAdmin) {
    adminSection.classList.remove('hidden');
    loadAdminStats();
  } else {
    adminSection.classList.add('hidden');
  }

  // Upload Document buttons visibility (teachers & admin only)
  const sectionUploadBtn = document.getElementById('sectionUploadBtn');
  const mobileUploadBtn = document.getElementById('mobileUploadBtn');
  const emptyUploadBtn = document.getElementById('emptyUploadBtn');
  
  const canUpload = (isAdmin || isTeacher);
  [sectionUploadBtn, mobileUploadBtn, emptyUploadBtn].forEach(btn => {
    if (btn) {
      if (canUpload) {
        btn.classList.remove('hidden');
      } else {
        btn.classList.add('hidden');
      }
    }
  });

  setupSubjectScopeUI();
  loadClassYears();
  showDashboardTab(isAdmin ? 'dashboard' : 'papers');
  fetchStats();
  if (window.lucide) lucide.createIcons();
}

async function loadAdminStats() {
  if (currentUser.role !== 'admin') return;
  try {
    const res = await fetch(`${API_BASE}/admin/teachers`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    if (res.ok) {
      const data = await res.json();
      const count = (data.teachers || []).length;
      document.getElementById('sideBadgeTeachersCount').textContent = count;
      document.getElementById('adminTableCountBadge').textContent = `${count} teachers`;
    }
  } catch (e) {}
}

// ==================== ADMIN DASHBOARD ====================

const adminCharts = { year: null, class: null };

async function loadAdminDashboard() {
  if (!currentUser || currentUser.role !== 'admin') return;
  try {
    const res = await fetch(`${API_BASE}/stats`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    if (!res.ok) return;
    const stats = await res.json();
    renderAdminDashboard(stats);
  } catch (e) {
    console.error('Error loading dashboard:', e);
  }
}

function renderAdminDashboard(stats) {
  const byClass = stats.byClass || {};
  const byYear = stats.byAcademicYear || {};

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  setText('dashTotalPapers', stats.totalPapers || 0);
  setText('dashBiologyPapers', stats.biologyCount || 0);
  setText('dashChemistryPapers', stats.chemistryCount || 0);
  setText('dashClassesCovered', Object.values(byClass).filter(n => n > 0).length);

  if (!window.Chart) return;

  const isDark = document.documentElement.classList.contains('dark');
  const tickColor = isDark ? '#94a3b8' : '#64748b';
  const gridColor = isDark ? '#243247' : '#e2e8f0';
  const tooltipBg = isDark ? '#0b1220' : '#1a3112';
  const pointFill = isDark ? '#16213a' : '#ffffff';

  Chart.defaults.font.family = "'Inter', ui-sans-serif, system-ui, sans-serif";
  Chart.defaults.color = tickColor;

  const years = Object.keys(byYear).sort((a, b) => Number(a) - Number(b));
  const yearValues = years.map(y => byYear[y] || 0);
  const yearCanvas = document.getElementById('yearTrendChart');

  if (adminCharts.year) adminCharts.year.destroy();
  if (yearCanvas) {
    adminCharts.year = new Chart(yearCanvas, {
      type: 'line',
      data: {
        labels: years,
        datasets: [{
          label: 'Papers',
          data: yearValues,
          borderColor: '#4a8833',
          backgroundColor: (context) => {
            const { ctx, chartArea } = context.chart;
            if (!chartArea) return 'rgba(115, 179, 75, 0.16)';
            const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, 'rgba(115, 179, 75, 0.35)');
            gradient.addColorStop(1, 'rgba(115, 179, 75, 0.02)');
            return gradient;
          },
          fill: true,
          tension: 0.35,
          borderWidth: 2.5,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: pointFill,
          pointBorderColor: '#4a8833',
          pointBorderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: tooltipBg,
            padding: 10,
            displayColors: false,
            callbacks: {
              label: (item) => `${item.parsed.y} paper${item.parsed.y === 1 ? '' : 's'}`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { color: tickColor }
          },
          y: {
            beginAtZero: true,
            ticks: { precision: 0, color: tickColor },
            grid: { color: gridColor },
            border: { display: false }
          }
        }
      }
    });
  }

  const classes = getClassYears();
  const classValues = classes.map(c => byClass[c] || 0);
  const classCanvas = document.getElementById('classDistributionChart');

  if (adminCharts.class) adminCharts.class.destroy();
  if (classCanvas) {
    adminCharts.class = new Chart(classCanvas, {
      type: 'bar',
      data: {
        labels: classes.map(c => c.replace(/^Year\s+/i, 'Y')),
        datasets: [{
          label: 'Papers',
          data: classValues,
          backgroundColor: '#73B34B',
          hoverBackgroundColor: '#4a8833',
          borderRadius: 6,
          maxBarThickness: 44
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: tooltipBg,
            padding: 10,
            displayColors: false,
            callbacks: {
              title: (items) => classes[items[0].dataIndex],
              label: (item) => `${item.parsed.y} paper${item.parsed.y === 1 ? '' : 's'}`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { color: tickColor, font: { size: 11 } }
          },
          y: {
            beginAtZero: true,
            ticks: { precision: 0, color: tickColor },
            grid: { color: gridColor },
            border: { display: false }
          }
        }
      }
    });
  }
}

// ==================== SUBJECT SCOPING LOGIC ====================

function setupSubjectScopeUI() {
  const filterSubjectSelect = document.getElementById('filterSubject');
  const uploadSubjectSelect = document.getElementById('uploadSubject');
  const banner = document.getElementById('subjectScopeBanner');
  const bioCard = document.getElementById('statBioCard');
  const chemCard = document.getElementById('statChemCard');
  const navBio = document.getElementById('navBio');
  const navChem = document.getElementById('navChem');

  const isAdmin = currentUser.role === 'admin';
  const subjects = currentUser.assignedSubjects || ['Biology', 'Chemistry'];

  if (isAdmin || subjects.length > 1) {
    filterSubjectSelect.innerHTML = `
      <option value="all">All Subjects (Bio & Chem)</option>
      <option value="Biology">🧬 Biology</option>
      <option value="Chemistry">⚗️ Chemistry</option>
    `;
    filterSubjectSelect.disabled = false;

    uploadSubjectSelect.innerHTML = `
      <option value="" disabled selected>Select Subject</option>
      <option value="Biology">🧬 Biology</option>
      <option value="Chemistry">⚗️ Chemistry</option>
    `;

    banner.classList.add('hidden');
    bioCard.classList.remove('opacity-40');
    chemCard.classList.remove('opacity-40');
    navBio.classList.remove('hidden');
    navChem.classList.remove('hidden');
  } else if (subjects.length === 1) {
    const singleSubject = subjects[0];
    const isBio = singleSubject === 'Biology';

    filterSubjectSelect.innerHTML = `
      <option value="${singleSubject}" selected>${isBio ? '🧬 Biology' : '⚗️ Chemistry'} (Assigned)</option>
    `;
    filterSubjectSelect.disabled = true;

    uploadSubjectSelect.innerHTML = `
      <option value="${singleSubject}" selected>${isBio ? '🧬 Biology' : '⚗️ Chemistry'}</option>
    `;

    banner.classList.remove('hidden');
    banner.className = 'p-3 rounded-lg border border-school-200 bg-school-50 text-school-900 flex items-center justify-between shadow-sm';

    document.getElementById('scopeBannerIcon').innerHTML = `<i data-lucide="${isBio ? 'dna' : 'flask-conical'}" class="w-5 h-5 text-school-700"></i>`;
    document.getElementById('scopeBannerTitle').textContent = `${singleSubject} only`;
    document.getElementById('scopeBannerText').textContent = `Upload and download ${singleSubject} papers for your assigned subject.`;
    
    const tag = document.getElementById('scopeBannerTag');
    tag.textContent = `${singleSubject} Only`;
    tag.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-school-200 text-school-900 border border-school-300 uppercase tracking-wider';

    if (isBio) {
      bioCard.classList.remove('opacity-40');
      chemCard.classList.add('opacity-40');
      navBio.classList.remove('hidden');
      navChem.classList.add('hidden');
    } else {
      chemCard.classList.remove('opacity-40');
      bioCard.classList.add('opacity-40');
      navBio.classList.add('hidden');
      navChem.classList.remove('hidden');
    }
  }

  if (window.lucide) lucide.createIcons();
}

// ==================== SIDEBAR CLICKS & FILTER LOGIC ====================

function selectFilterFromSidebar(type, value) {
  if (mobileSidebarOpen) toggleMobileSidebar();

  const classSelect = document.getElementById('filterClass');
  const subjSelect = document.getElementById('filterSubject');
  const acadSelect = document.getElementById('filterAcademicYear');
  const termSelect = document.getElementById('filterTerm');

  const wasYear = classSelect.value;
  const wasSubject = subjSelect.value;
  const wasAcad = acadSelect.value;
  const wasTerm = termSelect.value;

  // Sidebar links are full views: reset the other filters so the list
  // matches the count shown next to the selected item.
  classSelect.value = 'all';
  if (!subjSelect.disabled) subjSelect.value = 'all';
  acadSelect.value = 'all';
  termSelect.value = 'all';
  document.getElementById('searchInput').value = '';

  if (type === 'subject') {
    if (!subjSelect.disabled) {
      subjSelect.value = (wasSubject === value) ? 'all' : value;
    }
  } else if (type === 'year') {
    classSelect.value = (wasYear === value) ? 'all' : value;
  } else if (type === 'academicYear') {
    acadSelect.value = (wasAcad === value) ? 'all' : value;
  } else if (type === 'term') {
    termSelect.value = (wasTerm === value) ? 'all' : value;
  }

  onFilterChange();
}

function applyFilters() {
  console.log('Apply Filters clicked');
  const classVal = document.getElementById('filterClass').value;
  const subjVal = document.getElementById('filterSubject').value;
  const acadVal = document.getElementById('filterAcademicYear').value;
  const termVal = document.getElementById('filterTerm').value;
  
  console.log('Filters:', { classVal, subjVal, acadVal, termVal });
  
  // Visual feedback
  const btn = event?.target?.closest('button');
  if (btn) {
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i><span>Filtering...</span>';
    if (window.lucide) lucide.createIcons();
    
    setTimeout(() => {
      btn.innerHTML = originalText;
      if (window.lucide) lucide.createIcons();
    }, 500);
  }
  
  onFilterChange();
}

function onFilterChange() {
  updateSidebarActiveStyles();
  updateBreadcrumbTitle();
  fetchPapers();
}

function updateSidebarActiveStyles() {
  const currentClass = document.getElementById('filterClass').value;
  const currentSubj = document.getElementById('filterSubject').value;
  const currentAcadYear = document.getElementById('filterAcademicYear').value;
  const currentTerm = document.getElementById('filterTerm').value;

  document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));

  if (currentClass === 'all' && currentSubj === 'all' && currentAcadYear === 'all' && currentTerm === 'all') {
    document.getElementById('navAllPapers')?.classList.add('active');
  }

  if (currentSubj === 'Biology') {
    document.getElementById('navBio')?.classList.add('active');
  } else if (currentSubj === 'Chemistry') {
    document.getElementById('navChem')?.classList.add('active');
  }

  if (currentClass !== 'all') {
    const safeYearId = 'navYear_' + currentClass.replace(/\s+/g, '');
    document.getElementById(safeYearId)?.classList.add('active');
  }

  if (currentAcadYear !== 'all') {
    const safeAcadId = 'navAcad_' + currentAcadYear;
    document.getElementById(safeAcadId)?.classList.add('active');
  }
}

function updateBreadcrumbTitle() {
  const currentClass = document.getElementById('filterClass').value;
  const currentSubj = document.getElementById('filterSubject').value;
  const currentAcadYear = document.getElementById('filterAcademicYear').value;
  const currentTerm = document.getElementById('filterTerm').value;
  const searchVal = document.getElementById('searchInput').value.trim();

  let parts = [];
  if (currentClass !== 'all') parts.push(currentClass);
  if (currentSubj !== 'all') parts.push(currentSubj);
  if (currentAcadYear !== 'all') parts.push(`Year ${currentAcadYear}`);
  if (currentTerm !== 'all') parts.push(currentTerm);
  if (searchVal) parts.push(`"${searchVal}"`);

  const titleEl = document.getElementById('currentViewTitle');
  if (!titleEl) return;
  if (parts.length === 0) {
    titleEl.textContent = 'All Papers';
  } else {
    titleEl.textContent = parts.join(' • ');
  }
}

// ==================== PAPERS & STATS ====================

function getClassYears() {
  return classYears.length ? classYears : DEFAULT_CLASS_YEARS;
}

async function loadClassYears() {
  try {
    const res = await fetch(`${API_BASE}/classes`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!Array.isArray(data.classes) || data.classes.length === 0) return;

    classYears = data.classes;
    populateClassSelects();

    if (lastStats) {
      renderSidebarYears(lastStats.byClass || {});
      if (activeDashboardTab === 'dashboard' && currentUser && currentUser.role === 'admin') {
        renderAdminDashboard(lastStats);
      }
    }
  } catch (e) {
    console.error('Error loading classes:', e);
  }
}

function populateClassSelects() {
  const years = getClassYears();

  const filter = document.getElementById('filterClass');
  if (filter) {
    const prev = filter.value;
    filter.innerHTML = '<option value="all">All Classes</option>' +
      years.map(y => `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`).join('');
    filter.value = years.includes(prev) ? prev : 'all';
  }

  const upload = document.getElementById('uploadClass');
  if (upload) {
    const prev = upload.value;
    upload.innerHTML = '<option value="" disabled>Select Year/Class</option>' +
      years.map(y => `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`).join('');
    upload.value = years.includes(prev) ? prev : '';
  }
}

async function fetchStats() {
  try {
    const res = await fetch(`${API_BASE}/stats`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    if (!res.ok) return;
    const stats = await res.json();
    lastStats = stats;
    
    document.getElementById('statTotalPapers').textContent = stats.totalPapers || 0;
    document.getElementById('statBiologyPapers').textContent = stats.biologyCount || 0;
    document.getElementById('statChemistryPapers').textContent = stats.chemistryCount || 0;

    document.getElementById('sideBadgeTotal').textContent = stats.totalPapers || 0;
    document.getElementById('sideBadgeBio').textContent = stats.biologyCount || 0;
    document.getElementById('sideBadgeChem').textContent = stats.chemistryCount || 0;

    renderSidebarYears(stats.byClass || {});
    renderSidebarAcademicYears(stats.byAcademicYear || {});
  } catch (e) {
    console.error('Error loading stats:', e);
  }
}

function renderSidebarYears(byClass = {}) {
  const container = document.getElementById('sideYearsNav');
  if (!container) return;

  const currentClass = document.getElementById('filterClass').value;
  const years = getClassYears();

  container.innerHTML = years.map(yr => {
    const isSelected = currentClass === yr;
    const count = byClass[yr] || 0;
    const safeYearId = 'navYear_' + yr.replace(/\s+/g, '');

    return `
      <button 
        id="${safeYearId}"
        onclick="showDashboardTab('papers'); selectFilterFromSidebar('year', '${yr}')"
        class="sidebar-item ${isSelected ? 'active' : ''} w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs text-left text-slate-300 font-medium"
      >
        <div class="flex items-center space-x-2">
          <i data-lucide="folder" class="w-3.5 h-3.5 text-school-400"></i>
          <span>${yr}</span>
        </div>
        <span class="text-[10px] bg-school-900/80 px-2 py-0.5 rounded text-school-300 font-mono">
          ${count}
        </span>
      </button>
    `;
  }).join('') + ((currentUser && currentUser.role === 'admin') ? `
      <button 
        id="navAddClass"
        onclick="openAddClassModal()"
        class="sidebar-item mt-1 w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border border-dashed border-school-400 hover:bg-school-100 transition"
      >
        <i data-lucide="plus" class="w-3.5 h-3.5"></i>
        <span>Add Year / Class</span>
      </button>
    ` : '');

  if (window.lucide) lucide.createIcons();
}

function renderSidebarAcademicYears(byAcademicYear = {}) {
  const container = document.getElementById('sideAcademicYearsNav');
  if (!container) return;

  const currentAcadYear = document.getElementById('filterAcademicYear').value;
  const academicYears = ['2026', '2025', '2024', '2023', '2022', '2021'];

  container.innerHTML = academicYears.map(yr => {
    const isSelected = currentAcadYear === yr;
    const count = byAcademicYear[yr] || 0;
    const safeAcadId = 'navAcad_' + yr;

    return `
      <button 
        id="${safeAcadId}"
        onclick="showDashboardTab('papers'); selectFilterFromSidebar('academicYear', '${yr}')"
        class="sidebar-item ${isSelected ? 'active' : ''} w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs text-left text-slate-300 font-medium"
      >
        <div class="flex items-center space-x-2">
          <i data-lucide="calendar" class="w-3.5 h-3.5 text-school-400"></i>
          <span>${yr} Papers</span>
        </div>
        <span class="text-[10px] bg-school-900/80 px-2 py-0.5 rounded text-school-300 font-mono">
          ${count}
        </span>
      </button>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

async function fetchPapers() {
  const fetchId = ++papersFetchId;
  const classVal = document.getElementById('filterClass').value;
  const subjectVal = document.getElementById('filterSubject').value;
  const acadVal = document.getElementById('filterAcademicYear').value;
  const termVal = document.getElementById('filterTerm').value;
  const searchVal = document.getElementById('searchInput').value.trim();

  const params = new URLSearchParams();
  if (classVal !== 'all') params.append('classYear', classVal);
  if (subjectVal !== 'all') params.append('subject', subjectVal);
  if (acadVal !== 'all') params.append('academicYear', acadVal);
  if (termVal !== 'all') params.append('term', termVal);
  if (searchVal) params.append('search', searchVal);

  const container = document.getElementById('papersListContainer');
  const emptyState = document.getElementById('emptyState');
  const resultsCount = document.getElementById('paperResultsCount');

  container.innerHTML = `
    <div class="py-16 text-center text-slate-400">
      <div class="inline-block animate-spin w-8 h-8 border-4 border-school-600 border-t-transparent rounded-full mb-3"></div>
      <p class="text-sm">Filtering repository papers...</p>
    </div>
  `;

  try {
    const res = await fetch(`${API_BASE}/papers?${params.toString()}`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });

    if (res.status === 401) {
      logout();
      return;
    }

    const data = await res.json();
    if (fetchId !== papersFetchId) return;
    papersList = data.papers || [];
    resultsCount.textContent = papersList.length;

    if (papersList.length === 0) {
      container.innerHTML = '';
      emptyState.classList.remove('hidden');
    } else {
      emptyState.classList.add('hidden');
      if (viewMode === 'grid') {
        renderGridView(papersList);
      } else {
        renderTableView(papersList);
      }
    }
  } catch (err) {
    if (fetchId !== papersFetchId) return;
    console.error('Failed to load papers:', err);
    container.innerHTML = `
      <div class="p-6 text-center text-red-600 bg-red-50 rounded-xl border border-red-200">
        Failed to load papers. Please check connection and try again.
      </div>
    `;
  }

  fetchStats();
}

function renderGridView(papers) {
  const container = document.getElementById('papersListContainer');
  const canDelete = currentUser && (currentUser.role === 'teacher' || currentUser.role === 'admin');

  container.innerHTML = `
    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-1.5 animate-fade-in">
      ${papers.map(p => {
        const isBio = p.subject === 'Biology';
        const badgeClass = isBio ? 'badge-biology' : 'badge-chemistry';
        const iconName = isBio ? 'dna' : 'flask-conical';
        const fileExt = getFileExtension(p.originalName);
        const subjectShort = isBio ? 'Bio' : 'Chem';
        const yearShort = (p.classYear || '').replace('Year ', 'Y');
        const typeShort = (p.paperType || 'Exam').length > 10
          ? (p.paperType || 'Exam').slice(0, 8) + '…'
          : (p.paperType || 'Exam');

        return `
          <div class="paper-card bg-white rounded border border-slate-200 hover:border-school-400 shadow-sm flex flex-col justify-between overflow-hidden text-xs">
            <div class="p-1.5 flex-1">
              <div class="flex items-center justify-between gap-0.5 mb-1 flex-wrap">
                <div class="flex items-center gap-0.5">
                  <span class="px-0.5 py-0.5 rounded-full text-[7px] font-semibold ${badgeClass} flex items-center gap-0.5">
                    <i data-lucide="${iconName}" class="w-2 h-2"></i>
                    ${subjectShort}
                  </span>
                  <span class="px-0.5 py-0.5 rounded text-[7px] font-bold bg-school-50 text-school-800 border border-school-200">
                    ${yearShort}
                  </span>
                </div>
                <span class="text-[7px] font-semibold text-slate-500 bg-slate-100 px-0.5 py-0.5 rounded">
                  ${p.academicYear}
                </span>
              </div>

              <h3 class="font-semibold text-slate-900 text-[9px] leading-tight mb-0.5 line-clamp-2" title="${escapeHtml(p.title)}">
                ${escapeHtml(p.title)}
              </h3>

              <div class="flex items-center text-[7px] text-slate-400 gap-0.5 mb-0.5">
                <span class="font-medium text-school-600 truncate max-w-[70%]" title="${escapeHtml(p.paperType || 'Exam')}">${escapeHtml(typeShort)}</span>
                <span>·</span>
                <span class="shrink-0">${p.term.replace('Term ', 'T')}</span>
              </div>

              <div class="flex items-center text-[7px] text-slate-400 gap-1 pt-0.5 border-t border-slate-100">
                <span class="uppercase font-bold">${fileExt}</span>
                <span>${formatBytes(p.size)}</span>
              </div>
            </div>

            <div class="px-1.5 py-0.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
              <span class="text-[7px] text-slate-400">${p.downloadsCount || 0}↓</span>

              <div class="flex items-center gap-0.5">
                <button 
                  onclick="openPreviewModal('${p.id}')"
                  title="View"
                  aria-label="View paper"
                  class="p-0.5 text-school-700 hover:text-school-900 hover:bg-school-50 rounded transition"
                >
                  <i data-lucide="eye" class="w-2.5 h-2.5"></i>
                </button>

                <button 
                  onclick="downloadPaper('${p.id}', '${escapeHtml(p.originalName)}')"
                  title="Download"
                  aria-label="Download paper"
                  class="p-0.5 text-school-700 hover:text-school-900 bg-school-100 hover:bg-school-200 rounded transition active:scale-95"
                >
                  <i data-lucide="download" class="w-2.5 h-2.5"></i>
                </button>

                ${canDelete ? `
                  <button 
                    onclick="openDeletePaperModal('${p.id}')"
                    title="Delete"
                    aria-label="Delete paper"
                    class="p-0.5 text-red-600 hover:text-red-700 hover:bg-red-50 rounded transition"
                  >
                    <i data-lucide="trash-2" class="w-2.5 h-2.5"></i>
                  </button>
                ` : ''}
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  if (window.lucide) lucide.createIcons();
}

function renderTableView(papers) {
  const container = document.getElementById('papersListContainer');
  const canDelete = currentUser && (currentUser.role === 'teacher' || currentUser.role === 'admin');

  container.innerHTML = `
    <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden animate-fade-in">
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm text-slate-600">
          <thead class="bg-slate-50 text-xs uppercase font-semibold text-slate-500 border-b border-slate-200">
            <tr>
              <th class="px-4 py-3.5">Paper Title</th>
              <th class="px-4 py-3.5">Class</th>
              <th class="px-4 py-3.5">Subject</th>
              <th class="px-4 py-3.5">Academic Year</th>
              <th class="px-4 py-3.5">Term</th>
              <th class="px-4 py-3.5">Category</th>
              <th class="px-4 py-3.5">Size</th>
              <th class="px-4 py-3.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${papers.map(p => {
              const isBio = p.subject === 'Biology';
              const badgeClass = isBio ? 'badge-biology' : 'badge-chemistry';
              const fileExt = getFileExtension(p.originalName);

              return `
                <tr class="hover:bg-slate-50 transition">
                  <td class="px-4 py-3 font-semibold text-slate-800">
                    <div class="flex items-center space-x-2">
                      <i data-lucide="file-text" class="w-4 h-4 text-school-700 shrink-0"></i>
                      <div class="truncate max-w-xs" title="${escapeHtml(p.title)}">
                        ${escapeHtml(p.title)}
                        <span class="block text-[11px] font-normal text-slate-400 uppercase">${fileExt} • ${escapeHtml(p.originalName)}</span>
                      </div>
                    </div>
                  </td>
                  <td class="px-4 py-3 whitespace-nowrap">
                    <span class="px-2 py-0.5 rounded font-bold text-xs bg-school-50 text-school-800 border border-school-200">
                      ${p.classYear}
                    </span>
                  </td>
                  <td class="px-4 py-3 whitespace-nowrap">
                    <span class="px-2 py-0.5 rounded-full text-xs font-semibold ${badgeClass}">
                      ${p.subject}
                    </span>
                  </td>
                  <td class="px-4 py-3 whitespace-nowrap text-xs font-bold text-slate-700">
                    ${p.academicYear}
                  </td>
                  <td class="px-4 py-3 whitespace-nowrap text-xs text-slate-600">
                    ${p.term}
                  </td>
                  <td class="px-4 py-3 whitespace-nowrap text-xs text-slate-500">
                    ${p.paperType}
                  </td>
                  <td class="px-4 py-3 whitespace-nowrap text-xs text-slate-500">
                    ${formatBytes(p.size)}
                  </td>
                  <td class="px-4 py-3 whitespace-nowrap text-right space-x-2">
                    <button 
                      onclick="openPreviewModal('${p.id}')"
                      class="p-1.5 text-school-700 hover:text-school-900 bg-white hover:bg-school-50 border border-school-300 rounded transition"
                      title="View"
                      aria-label="View paper"
                    >
                      <i data-lucide="eye" class="w-4 h-4"></i>
                    </button>

                    <button 
                      onclick="downloadPaper('${p.id}', '${escapeHtml(p.originalName)}')"
                      class="p-1.5 text-school-700 hover:text-school-900 bg-school-50 hover:bg-school-100 border border-school-300 rounded transition"
                      title="Download"
                      aria-label="Download paper"
                    >
                      <i data-lucide="download" class="w-4 h-4"></i>
                    </button>

                    ${canDelete ? `
                      <button 
                        onclick="openDeletePaperModal('${p.id}')"
                        class="p-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 border border-transparent hover:border-red-200 rounded transition"
                        title="Delete"
                        aria-label="Delete paper"
                      >
                        <i data-lucide="trash-2" class="w-4 h-4 inline"></i>
                      </button>
                    ` : ''}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  if (window.lucide) lucide.createIcons();
}

function setViewMode(mode, rerender = true) {
  viewMode = mode;
  const gridBtn = document.getElementById('viewGridBtn');
  const listBtn = document.getElementById('viewListBtn');
  const base = 'flex items-center gap-1 px-2 py-1.5 sm:px-2.5 rounded-md text-xs font-semibold transition';

  if (mode === 'grid') {
    gridBtn.className = `${base} bg-white text-school-800 shadow-sm`;
    listBtn.className = `${base} text-slate-500 hover:text-slate-800`;
    gridBtn.setAttribute('aria-pressed', 'true');
    listBtn.setAttribute('aria-pressed', 'false');
    if (rerender) renderGridView(papersList);
  } else {
    listBtn.className = `${base} bg-white text-school-800 shadow-sm`;
    gridBtn.className = `${base} text-slate-500 hover:text-slate-800`;
    listBtn.setAttribute('aria-pressed', 'true');
    gridBtn.setAttribute('aria-pressed', 'false');
    if (rerender) renderTableView(papersList);
  }

  if (window.lucide) lucide.createIcons();
}

function debounceSearch() {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    updateBreadcrumbTitle();
    fetchPapers();
  }, 350);
}

// ==================== UPLOAD MODAL ====================

function openUploadModal() {
  if (!currentUser || (currentUser.role !== 'teacher' && currentUser.role !== 'admin')) {
    showToast('Permission required to upload documents.', 'warning');
    return;
  }
  
  const activeClass = document.getElementById('filterClass').value;
  const activeTerm = document.getElementById('filterTerm').value;
  const activeAcadYear = document.getElementById('filterAcademicYear').value;

  if (activeClass !== 'all') document.getElementById('uploadClass').value = activeClass;
  if (activeTerm !== 'all') document.getElementById('uploadTerm').value = activeTerm;
  if (activeAcadYear !== 'all') document.getElementById('uploadAcademicYear').value = activeAcadYear;

  const subtext = document.getElementById('uploadModalSubtext');
  if (currentUser.assignedSubjects && currentUser.assignedSubjects.length === 1) {
    subtext.textContent = `Authorized for ${currentUser.assignedSubjects[0]} papers only`;
  } else {
    subtext.textContent = `Upload Biology or Chemistry exams & tests`;
  }

  document.getElementById('uploadModal').classList.remove('hidden');
  document.getElementById('uploadError').classList.add('hidden');
  if (window.lucide) lucide.createIcons();
}

function closeUploadModal() {
  document.getElementById('uploadModal').classList.add('hidden');
  document.getElementById('uploadForm').reset();
  setupSubjectScopeUI();
  clearSelectedFile();
}

function handleFileSelected(input) {
  if (input.files && input.files[0]) {
    const file = input.files[0];
    document.getElementById('selectedFileName').textContent = file.name;
    document.getElementById('selectedFileSize').textContent = formatBytes(file.size);
    document.getElementById('dropZonePrompt').classList.add('hidden');
    document.getElementById('fileSelectedDisplay').classList.remove('hidden');
    document.getElementById('fileSelectedDisplay').classList.add('flex');
    if (window.lucide) lucide.createIcons();
  }
}

function clearSelectedFile(e) {
  if (e) e.stopPropagation();
  const fileInput = document.getElementById('fileInput');
  fileInput.value = '';
  document.getElementById('dropZonePrompt').classList.remove('hidden');
  document.getElementById('fileSelectedDisplay').classList.add('hidden');
  document.getElementById('fileSelectedDisplay').classList.remove('flex');
}

async function handleUploadSubmit(e) {
  e.preventDefault();
  const fileInput = document.getElementById('fileInput');
  const errorDiv = document.getElementById('uploadError');
  const submitBtn = document.getElementById('uploadSubmitBtn');

  if (!fileInput.files || fileInput.files.length === 0) {
    errorDiv.textContent = 'Please attach a paper file to upload.';
    errorDiv.classList.remove('hidden');
    return;
  }

  const formData = new FormData();
  formData.append('title', document.getElementById('uploadTitle').value.trim());
  formData.append('classYear', document.getElementById('uploadClass').value);
  formData.append('subject', document.getElementById('uploadSubject').value);
  formData.append('term', document.getElementById('uploadTerm').value);
  formData.append('academicYear', document.getElementById('uploadAcademicYear').value);
  formData.append('paperType', document.getElementById('uploadPaperType').value);
  formData.append('description', document.getElementById('uploadDescription').value.trim());
  formData.append('paperFile', fileInput.files[0]);

  errorDiv.classList.add('hidden');
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<span>Uploading...</span>`;

  try {
    const res = await fetch(`${API_BASE}/papers`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${currentToken}` },
      body: formData
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');

    closeUploadModal();
    showToast('Document uploaded successfully!', 'success');
    fetchPapers();
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<i data-lucide="cloud-upload" class="w-4 h-4"></i><span>Upload Paper</span>`;
    if (window.lucide) lucide.createIcons();
  }
}

// ==================== PREVIEW ====================

function openPreviewModal(id) {
  const paper = papersList.find(p => p.id === id) || teacherPapersCache.find(p => p.id === id);
  if (!paper) {
    showToast('Paper not found', 'error');
    return;
  }

  previewPaper = paper;
  revokePreviewUrl();

  document.getElementById('previewTitle').textContent = paper.title;
  document.getElementById('previewMeta').textContent = `${paper.classYear} • ${paper.subject} • ${paper.term} • ${paper.academicYear}`;
  document.getElementById('previewFileInfo').textContent = `${paper.originalName} • ${formatBytes(paper.size)}`;

  const frame = document.getElementById('previewFrame');
  const imageWrap = document.getElementById('previewImageWrap');
  const image = document.getElementById('previewImage');
  const loading = document.getElementById('previewLoading');
  const unavailable = document.getElementById('previewUnavailable');

  frame.classList.add('hidden');
  frame.removeAttribute('src');
  imageWrap.classList.add('hidden');
  image.removeAttribute('src');
  unavailable.classList.add('hidden');
  loading.classList.remove('hidden');

  document.getElementById('previewModal').classList.remove('hidden');
  if (window.lucide) lucide.createIcons();

  const ext = getFileExtension(paper.originalName).toLowerCase();
  const isPdf = ext === 'pdf';
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext);

  if (!isPdf && !isImage) {
    loading.classList.add('hidden');
    document.getElementById('previewUnavailableTitle').textContent = `Preview not available for ${ext} files`;
    document.getElementById('previewUnavailableText').textContent = 'Download the paper to open it in its native application.';
    unavailable.classList.remove('hidden');
    return;
  }

  fetch(`${API_BASE}/papers/${id}/view`, {
    headers: { 'Authorization': `Bearer ${currentToken}` }
  }).then(async res => {
    if (res.status === 401) {
      logout();
      return;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Could not load preview');
    }

    const blob = await res.blob();
    if (!previewPaper || previewPaper.id !== id) return;

    previewObjectUrl = URL.createObjectURL(blob);
    loading.classList.add('hidden');

    if (isPdf) {
      frame.src = previewObjectUrl;
      frame.classList.remove('hidden');
    } else {
      image.src = previewObjectUrl;
      imageWrap.classList.remove('hidden');
    }
  }).catch(err => {
    if (!previewPaper || previewPaper.id !== id) return;
    loading.classList.add('hidden');
    document.getElementById('previewUnavailableTitle').textContent = 'Could not load preview';
    document.getElementById('previewUnavailableText').textContent = err.message;
    unavailable.classList.remove('hidden');
  });
}

function revokePreviewUrl() {
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = null;
  }
}

function closePreviewModal() {
  const modal = document.getElementById('previewModal');
  if (modal) modal.classList.add('hidden');

  const frame = document.getElementById('previewFrame');
  const image = document.getElementById('previewImage');
  if (frame) {
    frame.removeAttribute('src');
    frame.classList.add('hidden');
  }
  if (image) image.removeAttribute('src');
  document.getElementById('previewImageWrap').classList.add('hidden');

  revokePreviewUrl();
  previewPaper = null;
}

function downloadPreviewedPaper() {
  if (!previewPaper) return;
  downloadPaper(previewPaper.id, previewPaper.originalName);
}

// ==================== DOWNLOAD & DELETE ====================

async function downloadPaper(id, filename) {
  try {
    showToast('Downloading paper...', 'info');
    const res = await fetch(`${API_BASE}/papers/${id}/download`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Could not download file');
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'examination-paper.pdf';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    fetchPapers();
  } catch (err) {
    showToast(err.message || 'Download failed', 'error');
  }
}

function openDeletePaperModal(id) {
  pendingDeletePaperId = id;
  const paper = papersList.find(p => p.id === id);
  const titleEl = document.getElementById('deletePaperTitle');
  if (titleEl) {
    titleEl.textContent = paper ? paper.title : 'Unknown paper';
  }
  const modal = document.getElementById('deletePaperModal');
  if (modal) modal.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function closeDeletePaperModal() {
  pendingDeletePaperId = null;
  const modal = document.getElementById('deletePaperModal');
  if (modal) modal.classList.add('hidden');
}

async function confirmDeletePaper() {
  const id = pendingDeletePaperId;
  if (!id) return;

  const confirmBtn = document.getElementById('deletePaperConfirmBtn');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<span>Deleting…</span>';
  }

  try {
    const res = await fetch(`${API_BASE}/papers/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not delete paper');

    closeDeletePaperModal();
    showToast('Paper deleted successfully', 'success');
    fetchPapers();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = '<i data-lucide="trash-2" class="w-4 h-4"></i><span>Delete</span>';
      if (window.lucide) lucide.createIcons();
    }
  }
}

// ==================== ADMINISTRATION: TEACHERS TABLE & CRUD ====================

async function loadAdminTeachersTable() {
  if (!currentUser || currentUser.role !== 'admin') return;
  console.log('Loading admin teachers table...');
  const tbody = document.getElementById('adminTeachersTableBody');
  const countBadge = document.getElementById('adminTableCountBadge');

  if (!tbody) {
    console.error('adminTeachersTableBody element not found!');
    return;
  }

  tbody.innerHTML = `
    <tr>
      <td colspan="6" class="px-5 py-12 text-center text-slate-400">
        <div class="inline-block animate-spin w-6 h-6 border-3 border-purple-600 border-t-transparent rounded-full mb-2"></div>
        <p class="text-xs">Loading faculty members...</p>
      </td>
    </tr>
  `;

  try {
    console.log('Fetching teachers from API...');
    const res = await fetch(`${API_BASE}/admin/teachers`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });

    console.log('API Response status:', res.status);
    if (!res.ok) throw new Error('Failed to load teachers');
    const data = await res.json();
    console.log('Teachers data received:', data);
    
    teachersList = data.teachers || [];
    console.log('Number of teachers:', teachersList.length);
    
    countBadge.textContent = `${teachersList.length} ${teachersList.length === 1 ? 'teacher' : 'teachers'}`;
    document.getElementById('sideBadgeTeachersCount').textContent = teachersList.length;

    if (teachersList.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="px-5 py-10 text-center text-slate-400">
            No teachers registered yet. Click "Register New Teacher" above to add one.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = teachersList.map(t => {
      const subjects = t.assignedSubjects || [];
      const isBio = subjects.length === 1 && subjects[0] === 'Biology';
      const isChem = subjects.length === 1 && subjects[0] === 'Chemistry';
      const isBoth = subjects.length > 1;

      let badgeHtml = '';
      if (isBoth) {
        badgeHtml = `<span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-800 border border-purple-200 flex items-center gap-1 w-max"><i data-lucide="layers" class="w-3.5 h-3.5 text-purple-600"></i> Both Bio & Chem</span>`;
      } else if (isBio) {
        badgeHtml = `<span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1 w-max"><i data-lucide="dna" class="w-3.5 h-3.5 text-emerald-600"></i> Biology Only</span>`;
      } else if (isChem) {
        badgeHtml = `<span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-teal-100 text-teal-800 border border-teal-200 flex items-center gap-1 w-max"><i data-lucide="flask-conical" class="w-3.5 h-3.5 text-teal-600"></i> Chemistry Only</span>`;
      }

      return `
        <tr class="hover:bg-slate-50 transition">
          <td class="px-5 py-4">
            <div class="flex items-center space-x-3">
              <div class="w-9 h-9 rounded-xl bg-purple-100 text-purple-800 flex items-center justify-center font-bold text-sm shrink-0 border border-purple-200">
                ${escapeHtml(t.name.charAt(0).toUpperCase())}
              </div>
              <div>
                <div class="font-bold text-slate-800 text-sm">${escapeHtml(t.name)}</div>
                <div class="text-[11px] text-slate-400">Added on ${new Date(t.createdAt).toLocaleDateString()}</div>
              </div>
            </div>
          </td>
          <td class="px-5 py-4 font-mono text-xs text-slate-700">
            <span class="bg-slate-100 px-2 py-1 rounded border border-slate-200">${escapeHtml(t.username)}</span>
          </td>
          <td class="px-5 py-4 whitespace-nowrap">
            ${badgeHtml}
          </td>
          <td class="px-5 py-4 whitespace-nowrap font-mono text-xs text-purple-700 font-bold">
            <span class="bg-purple-50 border border-purple-200 px-2 py-0.5 rounded">${escapeHtml(t.plainTextNotice || '123')}</span>
          </td>
          <td class="px-5 py-4 text-center font-bold text-sm text-slate-700">
            <span class="px-2.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-xs">${t.papersCount || 0}</span>
          </td>
          <td class="px-5 py-4 text-right whitespace-nowrap space-x-1">
            <button 
              onclick="openViewTeacherModal('${t.id}')"
              class="px-2 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-200 transition inline-flex items-center"
              title="View Details"
            >
              <i data-lucide="eye" class="w-4 h-4"></i>
            </button>

            <button 
              onclick="openEditTeacherModal('${t.id}')"
              class="px-2 py-2 rounded-lg text-xs font-semibold text-indigo-700 hover:bg-indigo-50 border border-indigo-200 transition inline-flex items-center"
              title="Edit Teacher"
            >
              <i data-lucide="pencil" class="w-4 h-4"></i>
            </button>

            <button 
              onclick="openDeleteTeacherModal('${t.id}')"
              class="px-2 py-2 rounded-lg text-xs font-semibold text-red-600 hover:bg-red-50 border border-red-200 transition inline-flex items-center"
              title="Delete Teacher"
            >
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');

    console.log('Teachers table rendered successfully');
    if (window.lucide) {
      lucide.createIcons();
      console.log('Lucide icons refreshed');
    }
  } catch (err) {
    console.error('Error loading teachers:', err);
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="px-5 py-10 text-center text-red-600 bg-red-50">
          <div class="text-sm font-semibold">Failed to load teachers</div>
          <div class="text-xs mt-1">${err.message}</div>
        </td>
      </tr>
    `;
  }
}

// Open/Close Add Teacher Modal
function openAddTeacherModal() {
  document.getElementById('addTeacherModal').classList.remove('hidden');
  document.getElementById('addTeacherForm').reset();
  // Ensure default password of 123 is pre-filled
  document.getElementById('newTeacherPassword').value = '123';
  document.getElementById('addTeacherError').classList.add('hidden');
  if (window.lucide) lucide.createIcons();
}

function closeAddTeacherModal() {
  document.getElementById('addTeacherModal').classList.add('hidden');
}

function openAddClassModal() {
  const modal = document.getElementById('addClassModal');
  if (!modal) return;
  document.getElementById('addClassForm').reset();
  document.getElementById('addClassError').classList.add('hidden');
  modal.classList.remove('hidden');
  document.getElementById('newClassName').focus();
  if (window.lucide) lucide.createIcons();
}

function closeAddClassModal() {
  const modal = document.getElementById('addClassModal');
  if (modal) modal.classList.add('hidden');
}

async function handleAddClassSubmit(e) {
  e.preventDefault();
  const input = document.getElementById('newClassName');
  const errorDiv = document.getElementById('addClassError');
  const btn = document.getElementById('addClassSubmitBtn');
  const name = input.value.trim();

  errorDiv.classList.add('hidden');
  btn.disabled = true;
  btn.innerHTML = '<span>Adding...</span>';

  try {
    const res = await fetch(`${API_BASE}/classes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ name })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not add class.');

    classYears = data.classes || classYears;
    populateClassSelects();
    renderSidebarYears((lastStats && lastStats.byClass) || {});

    const yearsNav = document.getElementById('sideYearsNav');
    if (yearsNav && yearsNav.classList.contains('hidden')) toggleSidebarSection('sideYearsNav');

    if (activeDashboardTab === 'dashboard' && lastStats) renderAdminDashboard(lastStats);

    closeAddClassModal();
    showToast(data.message || `Class "${name}" added.`, 'success');
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>Add Class</span>';
  }
}

async function handleAddTeacherSubmit(e) {
  e.preventDefault();
  const nameInput = document.getElementById('newTeacherName');
  const emailInput = document.getElementById('newTeacherEmail');
  const phoneInput = document.getElementById('newTeacherPhone');
  const usernameInput = document.getElementById('newTeacherUsername');
  const passwordInput = document.getElementById('newTeacherPassword');
  const subjectSelect = document.getElementById('newTeacherSubjects');
  const errorDiv = document.getElementById('addTeacherError');
  const btn = document.getElementById('addTeacherSubmitBtn');

  errorDiv.classList.add('hidden');
  btn.disabled = true;
  btn.innerHTML = `<span>Registering...</span>`;

  let assignedSubjects = [];
  if (subjectSelect.value === 'Both') {
    assignedSubjects = ['Biology', 'Chemistry'];
  } else {
    assignedSubjects = [subjectSelect.value];
  }

  // Default to 123 if empty
  const passwordVal = passwordInput.value.trim() || '123';

  try {
    const res = await fetch(`${API_BASE}/admin/teachers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({
        name: nameInput.value.trim(),
        email: emailInput.value.trim(),
        phone: phoneInput.value.trim(),
        username: usernameInput.value.trim(),
        password: passwordVal,
        assignedSubjects
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to register teacher.');

    closeAddTeacherModal();
    showToast(`Teacher "${data.teacher.name}" registered with default password (123)!`, 'success');
    loadAdminTeachersTable();
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span>Register Teacher</span>`;
  }
}

// Open/Close Edit Teacher Modal
function openEditTeacherModal(teacherId) {
  const teacher = teachersList.find(t => t.id === teacherId);
  if (!teacher) return;

  document.getElementById('editTeacherId').value = teacher.id;
  document.getElementById('editTeacherName').value = teacher.name;
  document.getElementById('editTeacherEmail').value = teacher.email || '';
  document.getElementById('editTeacherPhone').value = teacher.phone || '';
  document.getElementById('editTeacherUsername').value = teacher.username;
  document.getElementById('editTeacherPassword').value = '';
  document.getElementById('editTeacherError').classList.add('hidden');

  const subjects = teacher.assignedSubjects || [];
  const select = document.getElementById('editTeacherSubjects');
  if (subjects.length > 1) {
    select.value = 'Both';
  } else if (subjects[0] === 'Biology') {
    select.value = 'Biology';
  } else if (subjects[0] === 'Chemistry') {
    select.value = 'Chemistry';
  }

  document.getElementById('editTeacherModal').classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function closeEditTeacherModal() {
  document.getElementById('editTeacherModal').classList.add('hidden');
}

async function handleEditTeacherSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('editTeacherId').value;
  const name = document.getElementById('editTeacherName').value.trim();
  const email = document.getElementById('editTeacherEmail').value.trim();
  const phone = document.getElementById('editTeacherPhone').value.trim();
  const username = document.getElementById('editTeacherUsername').value.trim();
  const subjectSelect = document.getElementById('editTeacherSubjects').value;
  const password = document.getElementById('editTeacherPassword').value.trim();
  const errorDiv = document.getElementById('editTeacherError');
  const btn = document.getElementById('editTeacherSubmitBtn');

  let assignedSubjects = [];
  if (subjectSelect === 'Both') {
    assignedSubjects = ['Biology', 'Chemistry'];
  } else {
    assignedSubjects = [subjectSelect];
  }

  errorDiv.classList.add('hidden');
  btn.disabled = true;
  btn.innerHTML = `<span>Saving...</span>`;

  try {
    const payload = { name, email, phone, username, assignedSubjects };
    if (password) payload.password = password;

    const res = await fetch(`${API_BASE}/admin/teachers/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update teacher.');

    closeEditTeacherModal();
    showToast(`Teacher "${data.teacher.name}" updated successfully!`, 'success');
    loadAdminTeachersTable();
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span>Save Changes</span>`;
  }
}

// View Teacher Details Modal
async function openViewTeacherModal(teacherId) {
  try {
    const res = await fetch(`${API_BASE}/admin/teachers/${teacherId}/details`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });

    if (!res.ok) throw new Error('Could not load details');
    const data = await res.json();
    const teacher = data.teacher;
    const papers = data.papers || [];
    teacherPapersCache = papers;

    document.getElementById('detailTeacherAvatar').textContent = teacher.name.charAt(0).toUpperCase();
    document.getElementById('detailTeacherName').textContent = teacher.name;
    document.getElementById('detailTeacherUsername').textContent = '@' + teacher.username;
    document.getElementById('detailTeacherPassword').textContent = teacher.plainTextNotice || '123';
    document.getElementById('detailTeacherDate').textContent = new Date(teacher.createdAt).toLocaleDateString();
    document.getElementById('detailTeacherEmail').textContent = teacher.email || '—';
    document.getElementById('detailTeacherPhone').textContent = teacher.phone || '—';

    const scopeBadge = document.getElementById('detailTeacherScopeBadge');
    const subjects = teacher.assignedSubjects || [];
    if (subjects.length > 1) {
      scopeBadge.textContent = 'Both Subjects';
      scopeBadge.className = 'text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 border border-purple-200';
    } else if (subjects[0] === 'Biology') {
      scopeBadge.textContent = '🧬 Biology Only';
      scopeBadge.className = 'text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200';
    } else {
      scopeBadge.textContent = '⚗️ Chemistry Only';
      scopeBadge.className = 'text-xs font-semibold px-2 py-0.5 rounded-full bg-teal-100 text-teal-800 border border-teal-200';
    }

    const papersBadge = document.getElementById('detailTeacherPapersBadge');
    papersBadge.textContent = `${papers.length} ${papers.length === 1 ? 'paper' : 'papers'}`;

    const papersListEl = document.getElementById('detailTeacherPapersList');
    if (papers.length === 0) {
      papersListEl.innerHTML = `<div class="p-3 text-center text-slate-400 text-xs bg-slate-50 rounded-lg">No papers deposited yet by this teacher.</div>`;
    } else {
      papersListEl.innerHTML = papers.map(p => `
        <div class="p-2.5 rounded-lg border border-slate-200 bg-white flex items-center justify-between text-xs">
          <div class="truncate mr-2">
            <span class="font-bold text-slate-800 truncate block">${escapeHtml(p.title)}</span>
            <span class="text-[11px] text-slate-400">${p.classYear} • ${p.subject} • ${p.academicYear} (${p.term})</span>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <button 
              onclick="openPreviewModal('${p.id}')"
              class="px-2 py-1 bg-white border border-school-300 text-school-800 hover:bg-school-50 rounded text-[11px] font-semibold"
            >
              View
            </button>
            <button 
              onclick="downloadPaper('${p.id}', '${escapeHtml(p.originalName)}')"
              class="px-2 py-1 bg-school-700 hover:bg-school-800 text-white rounded text-[11px] font-semibold"
            >
              Download
            </button>
          </div>
        </div>
      `).join('');
    }

    document.getElementById('viewTeacherModal').classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function closeViewTeacherModal() {
  document.getElementById('viewTeacherModal').classList.add('hidden');
}

function openDeleteTeacherModal(id) {
  const teacher = teachersList.find(t => t.id === id);
  if (!teacher) return;

  pendingDeleteTeacherId = id;
  const nameEl = document.getElementById('deleteTeacherName');
  if (nameEl) nameEl.textContent = teacher.name;
  const usernameEl = document.getElementById('deleteTeacherUsername');
  if (usernameEl) usernameEl.textContent = '@' + teacher.username;

  document.getElementById('deleteTeacherModal').classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function closeDeleteTeacherModal() {
  pendingDeleteTeacherId = null;
  document.getElementById('deleteTeacherModal').classList.add('hidden');
  const btn = document.getElementById('deleteTeacherConfirmBtn');
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="trash-2" class="w-4 h-4"></i><span>Delete</span>';
    if (window.lucide) lucide.createIcons();
  }
}

async function confirmDeleteTeacher() {
  const id = pendingDeleteTeacherId;
  if (!id) return;

  const confirmBtn = document.getElementById('deleteTeacherConfirmBtn');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<span>Deleting…</span>';
  }

  try {
    const res = await fetch(`${API_BASE}/admin/teachers/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not remove teacher.');

    closeDeleteTeacherModal();
    showToast(data.message || 'Teacher removed', 'success');
    loadAdminTeachersTable();
  } catch (err) {
    showToast(err.message, 'error');
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = '<i data-lucide="trash-2" class="w-4 h-4"></i><span>Delete</span>';
      if (window.lucide) lucide.createIcons();
    }
  }
}

// ==================== UTILITIES ====================

function formatBytes(bytes, decimals = 1) {
  if (!+bytes) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function getFileExtension(filename) {
  if (!filename) return 'FILE';
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop().toUpperCase() : 'FILE';
}

function escapeHtml(string) {
  if (!string) return '';
  return String(string)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  const toastCard = document.getElementById('toastCard');
  const msgEl = document.getElementById('toastMessage');
  const iconEl = document.getElementById('toastIcon');

  msgEl.textContent = message;

  if (type === 'success') {
    toastCard.className = 'bg-school-800 text-white px-4 py-3 rounded-xl shadow-xl flex items-center space-x-3 text-sm border border-school-600';
    iconEl.innerHTML = '<i data-lucide="check-circle-2" class="w-5 h-5 text-emerald-300"></i>';
  } else if (type === 'error') {
    toastCard.className = 'bg-red-700 text-white px-4 py-3 rounded-xl shadow-xl flex items-center space-x-3 text-sm border border-red-500';
    iconEl.innerHTML = '<i data-lucide="alert-triangle" class="w-5 h-5 text-red-200"></i>';
  } else if (type === 'warning') {
    toastCard.className = 'bg-amber-600 text-white px-4 py-3 rounded-xl shadow-xl flex items-center space-x-3 text-sm border border-amber-400';
    iconEl.innerHTML = '<i data-lucide="alert-circle" class="w-5 h-5 text-amber-200"></i>';
  } else {
    toastCard.className = 'bg-slate-800 text-white px-4 py-3 rounded-xl shadow-xl flex items-center space-x-3 text-sm';
    iconEl.innerHTML = '<i data-lucide="info" class="w-5 h-5 text-slate-300"></i>';
  }

  if (window.lucide) lucide.createIcons();

  toast.classList.remove('opacity-0', 'translate-y-20', 'pointer-events-none');
  toast.classList.add('opacity-100', 'translate-y-0');

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-20', 'pointer-events-none');
    toast.classList.remove('opacity-100', 'translate-y-0');
  }, 3500);
}

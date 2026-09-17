function renderNavigation(user = null) {
    const role = String(
        user?.actualRole || user?.role || ''
    ).trim().toLowerCase();

    const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const icons = {
        dashboard: '⌂', competitions: '♜', games: '◉', assigned: '▣',
        officials: '♟', activity: '▤', finance: '◫', users: '♙',
        statistics: '◒', reports: '▤'
    };

    const link = (href, label, iconName = 'dashboard', report = false) => `
        <a class="${report ? 'arab-report-link' : 'arab-nav-link'}" href="${href}">
            <span class="arab-nav-icon" aria-hidden="true">${icons[iconName] || '•'}</span>
            <span class="arab-nav-label">${label}</span>
        </a>
    `;

    let sidebarContent = '';

    if (role === 'admin') {
        sidebarContent = `
            ${link('/', 'Dashboard', 'dashboard')}
            ${link('/competitions', 'Competitions', 'competitions')}
            ${link('/games', 'Games', 'games')}
            ${link('/assigned-games', 'Assigned Games', 'assigned')}
            ${link('/officials', 'Officials', 'officials')}
            ${link('/official-activity', 'Official Activity', 'activity')}
            ${link('/finance', 'Finance', 'finance')}
            ${link('/users', 'User Management', 'users')}
            <button type="button" id="arabReportsToggle" class="arab-reports-toggle" onclick="toggleARABReports()" aria-expanded="false">
                <span class="arab-nav-icon" aria-hidden="true">${icons.reports}</span>
                <span class="arab-nav-label">Reports</span>
                <span class="arab-reports-arrow" aria-hidden="true">▶</span>
            </button>
            <div id="arabReportsSubmenu" class="arab-reports-submenu">
                ${link('/statistics', 'Statistics', 'statistics', true)}
                ${link('/game-reports', 'Game Detail Reports', 'reports', true)}
            </div>
        `;
    } else if (role === 'finance') {
        sidebarContent = `
            ${link('/', 'Dashboard', 'dashboard')}
            ${link('/games', 'Games', 'games')}
            ${link('/assigned-games', 'Assigned Games', 'assigned')}
            ${link('/official-activity', 'Official Activity', 'activity')}
            ${link('/finance', 'Finance', 'finance')}
        `;
    } else if (role === 'to') {
        sidebarContent = `
            ${link('/', 'Dashboard', 'dashboard')}
            ${link('/competitions', 'Competitions', 'competitions')}
            ${link('/games', 'Games', 'games')}
            ${link('/assigned-games', 'Assigned Games', 'assigned')}
            ${link('/officials', 'Officials', 'officials')}
            ${link('/official-activity', 'Official Activity', 'activity')}
        `;
    } else if (role === 'referee' || role === 'official') {
        sidebarContent = `
            ${link('/', 'Dashboard', 'dashboard')}
            ${link('/games', 'Games', 'games')}
            ${link('/assigned-games', 'Assigned Games', 'assigned')}
            ${link('/official-activity', 'Official Activity', 'activity')}
        `;
    } else {
        sidebarContent = link('/', 'Dashboard', 'dashboard');
    }

    const name = user?.fullname || user?.username || '';
    const initials = String(name).trim().split(/\s+/).filter(Boolean).slice(0, 2).map(x => x.charAt(0)).join('').toUpperCase() || 'U';

    return `
<link rel="stylesheet" href="/css/arab-design.css">
<link rel="stylesheet" href="/css/arab-layout.css">
<link rel="stylesheet" href="/css/arab-responsive.css">

<aside id="arabSidebar" class="arab-sidebar" aria-label="ARAB main navigation">
        <div class="arab-sidebar-brand">
            <button type="button" class="arab-close-button arab-mobile-close" onclick="closeARABMenu()" aria-label="Close menu">×</button>
            <img class="arab-sidebar-logo" src="/images/arab-logo.png" alt="ARAB logo">
            <div class="arab-sidebar-brand-name">ARAB</div>
            <div class="arab-sidebar-brand-subtitle">Association Rwandaise des Arbitres de Basketball</div>
        </div>
        <div class="arab-sidebar-scroll">
            <div class="arab-nav-section-label">Main menu</div>
            <nav>${sidebarContent}</nav>
        </div>
        <div class="arab-sidebar-footer">
            <div class="arab-sidebar-motto"><strong>ARAB</strong>Fair Play · Better Basketball · A Stronger Rwanda</div>
        </div>
    </aside>

    <div id="arabOverlay" class="arab-overlay" onclick="closeARABMenu()"></div>

    <header class="arab-topbar">
        <button type="button" class="arab-menu-button" onclick="openARABMenu()" title="Open menu" aria-label="Open menu">☰</button>
        <div class="arab-topbar-brand">
            <img class="arab-topbar-logo" src="/images/arab-logo.png" alt="ARAB">
            <span class="arab-topbar-name">ARAB</span>
            <span class="arab-topbar-description">Association Rwandaise des Arbitres de Basketball</span>
        </div>
        ${user ? `
        <div class="arab-user-area" id="arabUserArea">
            <button type="button" class="arab-user-trigger" id="arabUserTrigger" aria-expanded="false" aria-controls="arabUserMenu">
                <span class="arab-user-avatar" aria-hidden="true">${escapeHtml(initials)}</span>
                <span class="arab-user-copy"><span class="arab-user-name">${escapeHtml(name)}</span><span class="arab-user-role">${escapeHtml(role || 'user')}</span></span>
                <span class="arab-user-chevron" aria-hidden="true">⌄</span>
            </button>
            <div class="arab-user-menu" id="arabUserMenu" hidden>
                <div class="arab-user-menu-heading"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(role || 'user')}</span></div>
                <div class="arab-user-menu-divider"></div>
                <a href="#" class="arab-user-menu-link" onclick="return false;">Profile</a>
                <form action="/logout" method="POST" class="arab-logout-form">
                    <button type="submit" class="arab-user-menu-link arab-user-menu-logout">Logout</button>
                </form>
            </div>
        </div>` : ''}
    </header>

<script src="/js/arab-navigation.js"></script>
`;
}

module.exports = renderNavigation;

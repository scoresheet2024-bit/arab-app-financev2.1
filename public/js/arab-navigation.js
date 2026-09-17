/* =========================================================
   ARAB MASTER NAVIGATION
   ========================================================= */
(function () {
    'use strict';

    if (window.__arabNavigationLoaded) return;
    window.__arabNavigationLoaded = true;
    document.body.classList.add('arab-app-shell');

    function sidebar() { return document.getElementById('arabSidebar'); }
    function overlay() { return document.getElementById('arabOverlay'); }

    window.openARABMenu = function () {
        const side = sidebar();
        const shade = overlay();
        if (side) side.classList.add('open');
        if (shade) shade.classList.add('open');
        document.body.classList.add('arab-menu-open');
    };

    window.closeARABMenu = function () {
        const side = sidebar();
        const shade = overlay();
        if (side) side.classList.remove('open');
        if (shade) shade.classList.remove('open');
        document.body.classList.remove('arab-menu-open');
    };

    window.toggleARABReports = function () {
        const submenu = document.getElementById('arabReportsSubmenu');
        const toggle = document.getElementById('arabReportsToggle');
        if (!submenu || !toggle) return;
        const isOpen = submenu.classList.toggle('open');
        toggle.classList.toggle('expanded', isOpen);
        toggle.setAttribute('aria-expanded', String(isOpen));
    };


    function initUserMenu() {
        const area = document.getElementById('arabUserArea');
        const trigger = document.getElementById('arabUserTrigger');
        const menu = document.getElementById('arabUserMenu');
        if (!area || !trigger || !menu) return;

        function closeUserMenu() {
            menu.hidden = true;
            trigger.setAttribute('aria-expanded', 'false');
        }

        function toggleUserMenu(event) {
            if (event) event.stopPropagation();
            const willOpen = menu.hidden;
            menu.hidden = !willOpen;
            trigger.setAttribute('aria-expanded', String(willOpen));
        }

        trigger.addEventListener('click', toggleUserMenu);
        menu.addEventListener('click', function (event) { event.stopPropagation(); });
        document.addEventListener('click', function (event) {
            if (!area.contains(event.target)) closeUserMenu();
        });
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') closeUserMenu();
        });
    }

    function markActiveLink() {
        const currentPath = window.location.pathname.replace(/\/$/, '') || '/';
        document.querySelectorAll('.arab-nav-link, .arab-report-link').forEach(function (link) {
            const href = link.getAttribute('href');
            if (!href) return;
            const linkPath = href.split('?')[0].replace(/\/$/, '') || '/';
            const isActive = linkPath === currentPath ||
                (linkPath !== '/' && currentPath.startsWith(linkPath + '/'));
            link.classList.toggle('active', isActive);
            if (isActive && link.classList.contains('arab-report-link')) {
                const submenu = document.getElementById('arabReportsSubmenu');
                const toggle = document.getElementById('arabReportsToggle');
                if (submenu && toggle) {
                    submenu.classList.add('open');
                    toggle.classList.add('expanded');
                    toggle.setAttribute('aria-expanded', 'true');
                }
            }
        });
    }

    document.addEventListener('click', function (event) {
        const link = event.target.closest && event.target.closest('.arab-nav-link, .arab-report-link');
        if (link) window.closeARABMenu();
    });

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') window.closeARABMenu();
    });

    window.addEventListener('resize', function () {
        if (window.innerWidth > 900) {
            const shade = overlay();
            if (shade) shade.classList.remove('open');
            document.body.classList.remove('arab-menu-open');
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { markActiveLink(); initUserMenu(); });
    } else {
        markActiveLink();
        initUserMenu();
    }
})();

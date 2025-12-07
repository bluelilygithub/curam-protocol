/**
 * Navbar Loader
 * Loads the reusable navbar component into pages and sets active states
 */
(function() {
    // Map of page files to their corresponding nav link
    const pageToNavMap = {
        'homepage.html': 'homepage',
        'about.html': 'about',
        'services.html': 'services',
        'target-markets.html': 'target-markets',
        'curam-ai-protocol.html': 'protocol',
        'roi.html': 'resources',
        'demo.html': 'resources',
        'feasibility-sprint-report.html': 'resources',
        'risk-audit-report.html': 'resources',
        'case-study.html': 'resources',
        'how-it-works.html': 'resources',
        'faq.html': 'faq',
        'blog.html': 'blog',
        'contact.html': 'contact'
    };

    function getCurrentPageName() {
        const path = window.location.pathname;
        const filename = path.split('/').pop() || 'homepage.html';
        return filename;
    }

    function setActiveNavItem() {
        const currentPage = getCurrentPageName();
        const activeNav = pageToNavMap[currentPage];
        
        if (!activeNav) return;

        // Remove active class from all nav items
        document.querySelectorAll('.nav-menu a').forEach(link => {
            link.classList.remove('active');
        });

        // Add active class to current page's nav item
        if (activeNav === 'resources') {
            // For resources pages, we might want to highlight the dropdown
            const resourcesDropdown = document.querySelector('.nav-dropdown');
            if (resourcesDropdown) {
                const dropdownToggle = resourcesDropdown.querySelector('a');
                if (dropdownToggle) {
                    dropdownToggle.classList.add('active');
                }
            }
        } else {
            // Find and activate the specific nav link
            const navLinks = document.querySelectorAll('.nav-menu a');
            navLinks.forEach(link => {
                const href = link.getAttribute('href');
                if (href && href.includes(activeNav + '.html')) {
                    link.classList.add('active');
                }
            });
        }
    }

    function loadNavbar() {
        const navbarPlaceholder = document.getElementById('navbar-placeholder');
        if (!navbarPlaceholder) return;

        fetch('assets/includes/navbar.html')
            .then(response => {
                if (!response.ok) {
                    throw new Error('Failed to load navbar');
                }
                return response.text();
            })
            .then(html => {
                navbarPlaceholder.innerHTML = html;
                // Set active state after navbar is loaded
                setActiveNavItem();
                
                // Dispatch event so main.js can initialize mobile menu
                document.dispatchEvent(new CustomEvent('navbarLoaded'));
            })
            .catch(error => {
                console.error('Error loading navbar:', error);
            });
    }

    // Load navbar when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadNavbar);
    } else {
        loadNavbar();
    }
})();


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
        'professional-services.html': 'target-markets',
        'logistics-compliance.html': 'target-markets',
        'built-environment.html': 'target-markets',
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
        const navLinks = document.querySelectorAll('.nav-menu a');
        navLinks.forEach(link => {
            const href = link.getAttribute('href');
            if (href) {
                // Check if this link matches the current page
                if (href.includes(activeNav + '.html') || 
                    (activeNav === 'target-markets' && (href === 'target-markets.html' || href === 'professional-services.html' || href === 'logistics-compliance.html' || href === 'built-environment.html')) ||
                    (activeNav === 'resources' && (href.includes('roi.html') || href.includes('demo.html') || href.includes('feasibility-sprint-report.html') || href.includes('risk-audit-report.html') || href.includes('case-study.html') || href.includes('how-it-works.html') || href.includes('blog.html')))) {
                    link.classList.add('active');
                }
            }
        });
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


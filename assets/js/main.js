// FSACE Protocol Website - Main JavaScript

document.addEventListener('DOMContentLoaded', function() {
    // Smooth scroll for anchor links
    const anchorLinks = document.querySelectorAll('a[href^="#"]');
    anchorLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            const href = this.getAttribute('href');
            if (href !== '#' && href.length > 1) {
                e.preventDefault();
                const target = document.querySelector(href);
                if (target) {
                    const offsetTop = target.offsetTop - 80; // Account for sticky nav
                    window.scrollTo({
                        top: offsetTop,
                        behavior: 'smooth'
                    });
                }
            }
        });
    });

    // Selector row interactions
    const selectorRows = document.querySelectorAll('.selector-row');
    selectorRows.forEach(row => {
        row.addEventListener('click', function() {
            const phase = this.getAttribute('data-phase');
            if (phase) {
                const targetCard = document.getElementById(phase);
                if (targetCard) {
                    const offsetTop = targetCard.offsetTop - 100;
                    window.scrollTo({
                        top: offsetTop,
                        behavior: 'smooth'
                    });
                    // Highlight the card briefly
                    targetCard.style.transition = 'all 0.3s ease';
                    targetCard.style.transform = 'scale(1.02)';
                    targetCard.style.boxShadow = '0 12px 32px rgba(212, 175, 55, 0.3)';
                    setTimeout(() => {
                        targetCard.style.transform = '';
                        targetCard.style.boxShadow = '';
                    }, 1000);
                }
            }
        });

        // Enhanced hover effect
        row.addEventListener('mouseenter', function() {
            const solution = this.querySelector('.selector-solution');
            if (solution) {
                solution.style.color = '#0F172A';
                solution.style.fontWeight = '600';
            }
        });

        row.addEventListener('mouseleave', function() {
            const solution = this.querySelector('.selector-solution');
            if (solution) {
                solution.style.color = '';
                solution.style.fontWeight = '';
            }
        });
    });

    // Navbar scroll effect
    let lastScroll = 0;
    const navbar = document.querySelector('.navbar');
    
    window.addEventListener('scroll', function() {
        const currentScroll = window.pageYOffset;
        
        if (currentScroll > 100) {
            navbar.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.1)';
        } else {
            navbar.style.boxShadow = 'none';
        }
        
        lastScroll = currentScroll;
    });

    // Protocol phase hover animations
    const protocolPhases = document.querySelectorAll('.protocol-phase');
    protocolPhases.forEach(phase => {
        phase.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-8px)';
        });
        
        phase.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0)';
        });
    });

    // Product card interactions
    const productCards = document.querySelectorAll('.product-card');
    productCards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            // Add subtle pulse to featured card
            if (this.classList.contains('product-card-featured')) {
                this.style.animation = 'pulse 2s ease-in-out infinite';
            }
        });
        
        card.addEventListener('mouseleave', function() {
            this.style.animation = '';
        });
    });

    // Intersection Observer for fade-in animations
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);

    // Observe sections for fade-in
    const sections = document.querySelectorAll('section');
    sections.forEach(section => {
        section.style.opacity = '0';
        section.style.transform = 'translateY(20px)';
        section.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(section);
    });

    // Metrics counter animation (if needed)
    const metrics = document.querySelectorAll('.metric-number');
    const metricsObserver = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting && !entry.target.classList.contains('counted')) {
                entry.target.classList.add('counted');
                const target = parseInt(entry.target.textContent.replace(/\D/g, ''));
                if (!isNaN(target) && target > 0) {
                    animateCounter(entry.target, target);
                }
            }
        });
    }, { threshold: 0.5 });

    metrics.forEach(metric => {
        metricsObserver.observe(metric);
    });

    function animateCounter(element, target) {
        const duration = 2000;
        const increment = target / (duration / 16);
        let current = 0;
        
        const timer = setInterval(() => {
            current += increment;
            if (current >= target) {
                element.textContent = element.textContent.includes('%') 
                    ? '100%' 
                    : target.toString();
                clearInterval(timer);
            } else {
                element.textContent = element.textContent.includes('%')
                    ? Math.floor(current) + '%'
                    : Math.floor(current).toString();
            }
        }, 16);
    }

    // Function to initialize mobile menu (can be called multiple times for dynamic navbars)
    function initializeMobileMenu() {
        const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
        const navContent = document.querySelector('.nav-content');
        
        if (mobileMenuToggle && navContent && !mobileMenuToggle.dataset.initialized) {
            mobileMenuToggle.dataset.initialized = 'true';
            
            mobileMenuToggle.addEventListener('click', function() {
                this.classList.toggle('active');
                navContent.classList.toggle('active');
                // Prevent body scroll when menu is open
                if (navContent.classList.contains('active')) {
                    document.body.style.overflow = 'hidden';
                } else {
                    document.body.style.overflow = '';
                }
            });
            
            // Close menu when clicking on a link
            const navLinks = navContent.querySelectorAll('a');
            navLinks.forEach(link => {
                link.addEventListener('click', function() {
                    mobileMenuToggle.classList.remove('active');
                    navContent.classList.remove('active');
                    document.body.style.overflow = '';
                });
            });
            
            // Close menu when clicking outside
            document.addEventListener('click', function(event) {
                const isClickInsideNav = navContent.contains(event.target);
                const isClickOnToggle = mobileMenuToggle.contains(event.target);
                
                if (!isClickInsideNav && !isClickOnToggle && navContent.classList.contains('active')) {
                    mobileMenuToggle.classList.remove('active');
                    navContent.classList.remove('active');
                    document.body.style.overflow = '';
                }
            });
        }
    }

    // Initialize mobile menu immediately (for static navbars)
    initializeMobileMenu();
    
    // Also listen for navbarLoaded event (for dynamically loaded navbars)
    document.addEventListener('navbarLoaded', initializeMobileMenu);

    // Function to initialize dropdowns (can be called multiple times for dynamic navbars)
    function initializeDropdowns() {
        const dropdowns = document.querySelectorAll('.nav-dropdown:not([data-dropdown-initialized])');
        dropdowns.forEach(dropdown => {
            dropdown.dataset.dropdownInitialized = 'true';
            const dropdownToggle = dropdown.querySelector('a');
            
            // Desktop: hover to open
            dropdown.addEventListener('mouseenter', function() {
                if (window.innerWidth > 768) {
                    this.classList.add('active');
                }
            });
            
            dropdown.addEventListener('mouseleave', function() {
                if (window.innerWidth > 768) {
                    this.classList.remove('active');
                }
            });
            
            // Mobile: click to toggle
            if (dropdownToggle) {
                dropdownToggle.addEventListener('click', function(e) {
                    if (window.innerWidth <= 768) {
                        e.preventDefault();
                        dropdown.classList.toggle('active');
                    }
                });
            }
        });
        
        // Close dropdowns when clicking outside (mobile) - only add once
        if (!document.body.dataset.dropdownHandlerAdded) {
            document.body.dataset.dropdownHandlerAdded = 'true';
            document.addEventListener('click', function(event) {
                if (window.innerWidth <= 768) {
                    document.querySelectorAll('.nav-dropdown').forEach(dropdown => {
                        if (!dropdown.contains(event.target)) {
                            dropdown.classList.remove('active');
                        }
                    });
                }
            });
        }
    }

    // Initialize dropdowns immediately (for static navbars)
    initializeDropdowns();
    
    // Also listen for navbarLoaded event (for dynamically loaded navbars)
    document.addEventListener('navbarLoaded', initializeDropdowns);

    // Function to initialize search inputs (can be called multiple times for dynamic navbars)
    function initializeSearchInputs() {
        const searchInputs = document.querySelectorAll('.nav-search-input:not([data-search-initialized])');
        
        searchInputs.forEach(input => {
            input.dataset.searchInitialized = 'true';
            
            // Update placeholder to indicate RAG search
            if (!input.placeholder.includes('blog') && !input.placeholder.includes('RAG') && !input.placeholder.includes('AI')) {
                input.placeholder = 'RAG Search...';
            }
            
            // Handle Enter key - redirect to search results page
            input.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const query = input.value.trim();
                    
                    if (query) {
                        // Redirect to search results page with query parameter
                        window.location.href = `search-results.html?q=${encodeURIComponent(query)}`;
                    }
                }
            });
            
            // Also handle form submission if input is in a form
            const form = input.closest('form');
            if (form) {
                form.addEventListener('submit', function(e) {
                    e.preventDefault();
                    const query = input.value.trim();
                    
                    if (query) {
                        window.location.href = `search-results.html?q=${encodeURIComponent(query)}`;
                    }
                });
            }
        });
        
        return searchInputs.length;
    }

    // Initialize search inputs immediately (for static navbars)
    initializeSearchInputs();
    
    // Also listen for navbarLoaded event (for dynamically loaded navbars)
    document.addEventListener('navbarLoaded', initializeSearchInputs);
    
    // Fallback: Check for search input periodically if not found initially
    // This handles edge cases where navbar loads asynchronously
    let retryCount = 0;
    const maxRetries = 10;
    const retryInterval = setInterval(function() {
        const uninitialized = document.querySelectorAll('.nav-search-input:not([data-search-initialized])');
        if (uninitialized.length > 0) {
            initializeSearchInputs();
            retryCount = 0; // Reset counter if we found inputs
        } else {
            retryCount++;
            if (retryCount >= maxRetries) {
                clearInterval(retryInterval);
            }
        }
    }, 200);
});

// Set up navbarLoaded listener outside DOMContentLoaded to ensure it's always ready
// This handles cases where the navbar loads before DOMContentLoaded fires
(function() {
    function initSearch() {
        const searchInputs = document.querySelectorAll('.nav-search-input:not([data-search-initialized])');
        
        searchInputs.forEach(input => {
            input.dataset.searchInitialized = 'true';
            
            if (!input.placeholder.includes('blog') && !input.placeholder.includes('RAG') && !input.placeholder.includes('AI')) {
                input.placeholder = 'RAG Search...';
            }
            
            input.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const query = input.value.trim();
                    if (query) {
                        window.location.href = `search-results.html?q=${encodeURIComponent(query)}`;
                    }
                }
            });
            
            const form = input.closest('form');
            if (form) {
                form.addEventListener('submit', function(e) {
                    e.preventDefault();
                    const query = input.value.trim();
                    if (query) {
                        window.location.href = `search-results.html?q=${encodeURIComponent(query)}`;
                    }
                });
            }
        });
    }
    
    // Listen for navbarLoaded event
    document.addEventListener('navbarLoaded', initSearch);
    
    // Also try to initialize immediately if navbar is already loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSearch);
    } else {
        initSearch();
    }
})();

// Video background handling
const heroVideo = document.querySelector('.hero-video-background video');
if (heroVideo) {
    // Ensure video plays
    heroVideo.play().catch(error => {
        console.log('Video autoplay prevented:', error);
        // Video will fallback to background color
    });
    
    // Handle video load errors (when file doesn't exist)
    heroVideo.addEventListener('error', function() {
        console.log('Video file not found, using fallback background');
        const videoContainer = document.querySelector('.hero-video-background');
        if (videoContainer) {
            videoContainer.style.background = 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)';
        }
    });
    
    // Show video once loaded
    heroVideo.addEventListener('loadeddata', function() {
        heroVideo.style.opacity = '1';
    });
}

// FAQ Accordion functionality
// Wrapped in DOMContentLoaded to ensure it runs after DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    const accordionHeaders = document.querySelectorAll('.faq-accordion-header');
    
    if (accordionHeaders.length > 0) {
        accordionHeaders.forEach(header => {
            // Mark as initialized to prevent duplicate handlers
            if (!header.dataset.accordionInitialized) {
                header.dataset.accordionInitialized = 'true';
                
                header.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    const item = this.closest('.faq-accordion-item') || this.parentElement;
                    const isActive = item.classList.contains('active');
                    
                    // Close all accordion items
                    document.querySelectorAll('.faq-accordion-item').forEach(accItem => {
                        if (accItem !== item) {
                            accItem.classList.remove('active');
                        }
                    });
                    
                    // Toggle current item
                    if (isActive) {
                        item.classList.remove('active');
                    } else {
                        item.classList.add('active');
                    }
                });
            }
        });
    }
});

// Add CSS animation for pulse
const style = document.createElement('style');
style.textContent = `
    @keyframes pulse {
        0%, 100% {
            transform: scale(1.05);
        }
        50% {
            transform: scale(1.08);
        }
    }
`;
document.head.appendChild(style);

// Scroll Down Button functionality
document.addEventListener('DOMContentLoaded', function() {
    const scrollDownBtn = document.querySelector('.scroll-down-btn');
    
    if (scrollDownBtn) {
        // Click handler - scroll to protocol section if it exists, otherwise scroll down one viewport
        scrollDownBtn.addEventListener('click', function() {
            const protocolSection = document.getElementById('protocol');
            if (protocolSection) {
                const offsetTop = protocolSection.offsetTop - 80; // Account for sticky nav
                window.scrollTo({
                    top: offsetTop,
                    behavior: 'smooth'
                });
            } else {
                // If no protocol section, scroll down one viewport height
                const viewportHeight = window.innerHeight;
                const currentScroll = window.scrollY || window.pageYOffset;
                window.scrollTo({
                    top: currentScroll + viewportHeight,
                    behavior: 'smooth'
                });
            }
        });
        
        // Show/hide based on scroll position - only hide when at bottom of page
        function handleScroll() {
            const windowHeight = window.innerHeight;
            const documentHeight = document.documentElement.scrollHeight;
            const scrollTop = window.scrollY || window.pageYOffset || document.documentElement.scrollTop;
            
            // Check if we're at the bottom of the page (with small threshold for rounding)
            const isAtBottom = scrollTop + windowHeight >= documentHeight - 10;
            
            // Hide button only if at bottom of page
            if (isAtBottom) {
                scrollDownBtn.classList.add('hidden');
            } else {
                scrollDownBtn.classList.remove('hidden');
            }
        }
        
        // Check on scroll
        window.addEventListener('scroll', handleScroll);
        // Check on resize (in case content height changes)
        window.addEventListener('resize', handleScroll);
        // Check on load
        handleScroll();
    }
});


// ============================================================================
// GLOBAL SEARCH BAR - DEBUG VERSION with extensive logging
// ============================================================================

(function initGlobalSearch() {
    console.log('🚀 SEARCH INIT: Script loaded and executing');
    
    let searchInitialized = false;
    let attemptCount = 0;
    
    function attachSearchListener() {
        attemptCount++;
        console.log(`🔍 SEARCH INIT: Attempt #${attemptCount}`);
        
        // Skip if already initialized
        if (searchInitialized) {
            console.log('✅ SEARCH INIT: Already initialized, skipping');
            return;
        }
        
        // Try to find the search input
        console.log('🔎 SEARCH INIT: Looking for .nav-search-input...');
        const searchInput = document.querySelector('.nav-search-input');
        
        if (!searchInput) {
            console.warn('❌ SEARCH INIT: Input not found yet');
            console.log('📋 SEARCH INIT: Available inputs:', document.querySelectorAll('input').length);
            console.log('📋 SEARCH INIT: Navbar placeholder exists:', !!document.getElementById('navbar-placeholder'));
            console.log('📋 SEARCH INIT: Navbar content loaded:', document.getElementById('navbar-placeholder')?.innerHTML.length > 0);
            return;
        }
        
        console.log('✅ SEARCH INIT: Input found!', searchInput);
        
        // Check if already has listener
        if (searchInput.hasAttribute('data-search-ready')) {
            console.log('ℹ️ SEARCH INIT: Input already has data-search-ready attribute');
            searchInitialized = true;
            return;
        }
        
        console.log('🔧 SEARCH INIT: Attaching Enter key listener...');
        
        // Attach the Enter key listener
        searchInput.addEventListener('keypress', function(e) {
            console.log('⌨️ SEARCH: Key pressed:', e.key, 'in search input');
            
            if (e.key === 'Enter') {
                console.log('✅ SEARCH: Enter key detected!');
                e.preventDefault();
                
                const query = this.value.trim();
                console.log('🔍 SEARCH: Query value:', query);
                
                if (query) {
                    const url = `/search-results?q=${encodeURIComponent(query)}`;
                    console.log('🚀 SEARCH: Redirecting to:', url);
                    window.location.href = url;
                } else {
                    console.warn('⚠️ SEARCH: Empty query, showing alert');
                    alert('Please enter a search term');
                }
            }
        });
        
        // Mark as initialized
        searchInput.setAttribute('data-search-ready', 'true');
        searchInitialized = true;
        console.log('✅ SEARCH INIT: Successfully initialized! Listener attached.');
        console.log('📊 SEARCH INIT: Total attempts:', attemptCount);
    }
    
    console.log('⏰ SEARCH INIT: Scheduling initialization attempts...');
    
    // Try multiple times with different delays
    attachSearchListener(); // Try immediately
    console.log('⏰ SEARCH INIT: Attempt 1 scheduled (0ms)');
    
    setTimeout(function() {
        console.log('⏰ SEARCH INIT: Running 300ms attempt...');
        attachSearchListener();
    }, 300);
    
    setTimeout(function() {
        console.log('⏰ SEARCH INIT: Running 600ms attempt...');
        attachSearchListener();
    }, 600);
    
    setTimeout(function() {
        console.log('⏰ SEARCH INIT: Running 1000ms attempt (final)...');
        attachSearchListener();
    }, 1000);
    
    // Final diagnostic after 1.5 seconds
    setTimeout(function() {
        console.log('📊 SEARCH DIAGNOSTIC: Final status check');
        console.log('  - Search initialized:', searchInitialized);
        console.log('  - Total attempts:', attemptCount);
        
        const input = document.querySelector('.nav-search-input');
        if (input) {
            console.log('  - Input exists: YES');
            console.log('  - Has data-search-ready:', input.hasAttribute('data-search-ready'));
            console.log('  - Input details:', {
                type: input.type,
                placeholder: input.placeholder,
                className: input.className,
                name: input.name
            });
        } else {
            console.error('  - Input exists: NO - THIS IS THE PROBLEM!');
            console.log('  - Navbar HTML:', document.querySelector('.navbar')?.outerHTML.substring(0, 200));
        }
    }, 1500);
    
})();

// Add a manual test function
window.testSearch = function() {
    console.log('🧪 MANUAL TEST: Testing search functionality...');
    const input = document.querySelector('.nav-search-input');
    if (input) {
        console.log('✅ Input found:', input);
        console.log('Has listener:', input.hasAttribute('data-search-ready'));
        input.value = 'test';
        console.log('Set test value, now press Enter or call: window.testSearchRedirect()');
    } else {
        console.error('❌ Input NOT found!');
    }
};

window.testSearchRedirect = function() {
    window.location.href = '/search-results?q=manual-test';
};
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

    // Mobile menu toggle
    const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
    const navContent = document.querySelector('.nav-content');
    
    if (mobileMenuToggle && navContent) {
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

    // Dropdown menu functionality
    const dropdowns = document.querySelectorAll('.nav-dropdown');
    dropdowns.forEach(dropdown => {
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
    
    // Close dropdowns when clicking outside (mobile)
    document.addEventListener('click', function(event) {
        if (window.innerWidth <= 768) {
            dropdowns.forEach(dropdown => {
                if (!dropdown.contains(event.target)) {
                    dropdown.classList.remove('active');
                }
            });
        }
    });

    // RAG Search Functionality - Redirects to dedicated search results page
    const searchInputs = document.querySelectorAll('.nav-search-input');
    
    searchInputs.forEach(input => {
        // Update placeholder to indicate AI search
        if (!input.placeholder.includes('blog') && !input.placeholder.includes('AI')) {
            input.placeholder = 'Ask AI about our services...';
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
});

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
const accordionHeaders = document.querySelectorAll('.faq-accordion-header');
accordionHeaders.forEach(header => {
    header.addEventListener('click', function() {
        const item = this.parentElement;
        const isActive = item.classList.contains('active');
        
        // Close all accordion items
        document.querySelectorAll('.faq-accordion-item').forEach(accItem => {
            accItem.classList.remove('active');
        });
        
        // Open clicked item if it wasn't active
        if (!isActive) {
            item.classList.add('active');
        }
    });
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


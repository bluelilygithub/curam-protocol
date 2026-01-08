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
    function initializeNavbarScroll() {
        const navbar = document.querySelector('.navbar');
        if (!navbar) return;
        
        window.addEventListener('scroll', function() {
            const currentScroll = window.pageYOffset;
            
            if (currentScroll > 100) {
                navbar.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.1)';
            } else {
                navbar.style.boxShadow = 'none';
            }
            
            lastScroll = currentScroll;
        });
    }
    
    // Initialize immediately if navbar exists, or wait for it
    initializeNavbarScroll();
    document.addEventListener('navbarLoaded', initializeNavbarScroll);

    // Protocol phase hover animations
    const protocolPhases = document.querySelectorAll('.protocol-phase');
    protocolPhases.forEach(phase => {
        phase.addEventListener('mouseenter', function() {
            this.style.willChange = 'transform';
            this.style.transform = 'translateY(-8px)';
        });
        
        phase.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0)';
            // Remove will-change after transition
            setTimeout(() => {
                this.style.willChange = 'auto';
            }, 300);
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
                // Remove will-change after animation completes for performance
                setTimeout(() => {
                    entry.target.style.willChange = 'auto';
                }, 600);
            }
        });
    }, observerOptions);

    // Observe sections for fade-in
    const sections = document.querySelectorAll('section');
    sections.forEach(section => {
        section.style.opacity = '0';
        section.style.transform = 'translateY(20px)';
        section.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        section.style.willChange = 'transform, opacity'; // Optimize paint
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

    // Speech Recognition for search bar
    let navRecognition = null;
    let isNavRecording = false;
    let isNavStopping = false;
    let isNavStopping = false; // Track if we're in the process of stopping
    
    // Make function globally accessible
    window.initNavSpeechRecognition = function() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const micBtn = document.getElementById('navSearchMicBtn');
        const searchInput = document.getElementById('navSearchInput');
        
        if (!micBtn || !searchInput) {
            return false;
        }
        
        // Check browser support
        if (!SpeechRecognition) {
            console.warn('Speech recognition not supported in this browser');
            if (micBtn) {
                micBtn.disabled = true;
                micBtn.title = 'Voice input not supported in this browser';
                micBtn.classList.add('error');
            }
            return false;
        }
        
        try {
            navRecognition = new SpeechRecognition();
            navRecognition.continuous = true; // Keep listening
            navRecognition.interimResults = true; // Show interim results
            navRecognition.lang = 'en-US';
            
            navRecognition.onstart = function() {
                // Only set flag when recognition actually starts
                isNavRecording = true;
                micBtn.classList.add('recording');
                micBtn.title = 'Listening... Click to stop';
                if (searchInput) {
                    searchInput.placeholder = 'Listening... Speak now';
                }
            };
            
            navRecognition.onresult = function(event) {
                console.log('📢 Nav onresult fired, results length:', event.results.length);
                let finalTranscript = '';
                let interimTranscript = '';
                
                // Loop through all results and accumulate transcripts
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    if (event.results[i] && event.results[i][0]) {
                        const transcript = event.results[i][0].transcript;
                        console.log(`  Result ${i}: "${transcript}" (isFinal: ${event.results[i].isFinal})`);
                        if (event.results[i].isFinal) {
                            finalTranscript += transcript + ' ';
                        } else {
                            interimTranscript += transcript;
                        }
                    }
                }
                
                console.log('  Final:', finalTranscript, 'Interim:', interimTranscript);
                
                // Get the input fresh to ensure we have the right reference
                const input = document.querySelector('.nav-search-input');
                if (!input) {
                    console.error('❌ nav-search-input not found in DOM!');
                    return;
                }
                
                // Update input with final results, or show interim
                if (finalTranscript) {
                    const currentValue = input.value.trim();
                    input.value = currentValue ? currentValue + ' ' + finalTranscript.trim() : finalTranscript.trim();
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    console.log('✅ Updated nav input with final:', input.value);
                } else if (interimTranscript) {
                    const currentValue = input.value.trim();
                    input.value = currentValue || interimTranscript;
                    console.log('✅ Updated nav input with interim:', input.value);
                }
            };
            
            navRecognition.onerror = function(event) {
                // In continuous mode, 'no-speech' is normal - just continue listening
                if (event.error === 'no-speech') {
                    return; // Don't stop or show error
                }
                
                // 'aborted' is normal when we manually stop
                if (event.error === 'aborted') {
                    isNavRecording = false;
                    isNavStopping = false; // Allow new actions after abort
                    micBtn.classList.remove('recording');
                    if (searchInput) {
                        searchInput.placeholder = 'AI Search...';
                    }
                    micBtn.title = 'Click to speak';
                    return;
                }
                
                // For other errors, stop and show error
                console.error('Speech recognition error:', event.error);
                isNavRecording = false;
                micBtn.classList.remove('recording');
                if (searchInput) {
                    searchInput.placeholder = 'AI Search...';
                }
                
                let errorMsg = 'Voice input error. ';
                switch(event.error) {
                    case 'audio-capture':
                        errorMsg += 'Microphone not found.';
                        micBtn.classList.add('error');
                        break;
                    case 'not-allowed':
                        errorMsg += 'Microphone permission denied.';
                        micBtn.classList.add('error');
                        break;
                    case 'network':
                        errorMsg += 'Network error.';
                        break;
                    default:
                        errorMsg += 'Please try again.';
                }
                
                micBtn.title = errorMsg;
                setTimeout(() => {
                    micBtn.classList.remove('error');
                    micBtn.title = 'Click to speak';
                }, 3000);
                
                try {
                    navRecognition.stop();
                } catch (err) {
                    // Ignore stop errors
                }
            };
            
            navRecognition.onend = function() {
                isNavRecording = false;
                isNavStopping = false; // Allow new actions after stop completes
                micBtn.classList.remove('recording');
                if (searchInput) {
                    searchInput.placeholder = 'AI Search...';
                }
                micBtn.title = 'Click to speak';
            };
            
            // Attach click handler to microphone button
            micBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                
                // Prevent double-clicks while stopping/starting
                if (isNavStopping) {
                    return;
                }
                
                // Check actual recognition state
                const actualState = navRecognition.state;
                const isCurrentlyRunning = (actualState === 'running' || actualState === 'starting') && isNavRecording;
                
                if (isCurrentlyRunning) {
                    // Stop recording - wait for onend to reset flag
                    isNavStopping = true;
                    try {
                        navRecognition.stop();
                        // UI will be reset in onend handler
                    } catch (err) {
                        // If stop fails, reset state manually
                        isNavStopping = false;
                        isNavRecording = false;
                        micBtn.classList.remove('recording');
                        if (searchInput) {
                            searchInput.placeholder = 'AI Search...';
                        }
                        micBtn.title = 'Click to speak';
                    }
                } else {
                    // Start recording - check state first
                    const state = navRecognition.state;
                    if (state === 'running' || state === 'starting') {
                        // Already running but flag was wrong - just sync the flag
                        isNavRecording = true;
                        micBtn.classList.add('recording');
                        if (searchInput) {
                            searchInput.placeholder = 'Listening... Speak now';
                        }
                        micBtn.title = 'Listening... Click to stop';
                        return;
                    }
                    
                    // Update UI optimistically
                    micBtn.classList.add('recording');
                    if (searchInput) {
                        searchInput.placeholder = 'Starting...';
                    }
                    micBtn.title = 'Starting...';
                    
                    try {
                        // Safe to start - onstart handler will set the flag
                        navRecognition.start();
                    } catch (error) {
                        console.error('Nav recognition start error:', error);
                        micBtn.classList.remove('recording');
                        if (searchInput) {
                            searchInput.placeholder = 'AI Search...';
                        }
                        micBtn.title = 'Click to speak';
                        
                        // If invalid state error, it's already running - sync state instead
                        if (error.name === 'InvalidStateError' || (error.message && error.message.includes('already'))) {
                            // Recognition is already running - just sync our state
                            isNavRecording = true;
                            micBtn.classList.add('recording');
                            if (searchInput) {
                                searchInput.placeholder = 'Listening... Speak now';
                            }
                            micBtn.title = 'Listening... Click to stop';
                        }
                    }
                }
            });
            
            return true;
        } catch (error) {
            console.error('Failed to initialize speech recognition:', error);
            if (micBtn) {
                micBtn.disabled = true;
                micBtn.title = 'Voice input unavailable';
            }
            return false;
        }
    }

    // Function to initialize search inputs (can be called multiple times for dynamic navbars)
    function initializeSearchInputs() {
        const searchInputs = document.querySelectorAll('.nav-search-input:not([data-search-initialized])');
        
        searchInputs.forEach(input => {
            input.dataset.searchInitialized = 'true';
            
            // Update placeholder to indicate AI search
            if (!input.placeholder.includes('blog') && !input.placeholder.includes('RAG') && !input.placeholder.includes('AI')) {
                input.placeholder = 'AI Search...';
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
        
        // Initialize speech recognition for search bar
        initNavSpeechRecognition();
        
        return searchInputs.length;
    }

    // Initialize search inputs immediately (for static navbars)
    initializeSearchInputs();
    
    // Also listen for navbarLoaded event (for dynamically loaded navbars)
    document.addEventListener('navbarLoaded', function() {
        initializeSearchInputs();
        // Re-initialize speech recognition after navbar loads
        setTimeout(initNavSpeechRecognition, 100);
    });
    
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
                input.placeholder = 'AI Search...';
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
    document.addEventListener('navbarLoaded', function() {
        initSearch();
        if (window.initNavSpeechRecognition) {
            setTimeout(window.initNavSpeechRecognition, 100);
        }
    });
    
    // Also try to initialize immediately if navbar is already loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            initSearch();
            if (window.initNavSpeechRecognition) {
                setTimeout(window.initNavSpeechRecognition, 100);
            }
        });
    } else {
        initSearch();
        if (window.initNavSpeechRecognition) {
            setTimeout(window.initNavSpeechRecognition, 100);
        }
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
function initializeScrollDownButton() {
    const scrollDownBtn = document.querySelector('.scroll-down-btn');
    
    if (!scrollDownBtn) {
        return;
    }
    
    // Find all major sections on the page
    // Look for all sections, including contact-section, faq, etc.
    const sections = Array.from(document.querySelectorAll('section'));
    
    // Filter to get only visible, meaningful sections (exclude footer/header sections)
    const mainSections = sections.filter(section => {
        // Wait for layout to calculate - force a reflow if needed
        const height = section.offsetHeight || section.getBoundingClientRect().height;
        // Only count sections taller than 100px and exclude common footer/header patterns
        const classList = Array.from(section.classList);
        const isExcluded = classList.some(cls => 
            cls.includes('footer') || cls.includes('header') || cls.includes('nav')
        );
        // If height is 0, it might be hidden or not rendered yet - skip those
        const isValid = height > 100 && !isExcluded && section.offsetTop >= 0;
        return isValid;
    });
    
    // Sort sections by their position on the page (top to bottom) using absolute positions
    mainSections.sort((a, b) => {
        const rectA = a.getBoundingClientRect();
        const rectB = b.getBoundingClientRect();
        const scrollTop = window.scrollY || window.pageYOffset;
        const topA = rectA.top + scrollTop;
        const topB = rectB.top + scrollTop;
        return topA - topB;
    });
    
    if (mainSections.length === 0) {
        return;
    }
    
    function getCurrentSectionIndex() {
        const scrollTop = window.scrollY || window.pageYOffset || document.documentElement.scrollTop;
        const windowHeight = window.innerHeight;
        const viewportCenter = scrollTop + (windowHeight / 2);
        
        // Find which section is closest to viewport center
        let closestIndex = 0;
        let closestDistance = Infinity;
        
        mainSections.forEach((section, index) => {
            // Use getBoundingClientRect for absolute position (accounts for parent containers)
            const rect = section.getBoundingClientRect();
            const sectionTop = rect.top + scrollTop;
            const sectionHeight = rect.height || section.offsetHeight;
            const sectionBottom = sectionTop + sectionHeight;
            const sectionCenter = sectionTop + (sectionHeight / 2);
            
            // Check if viewport center is within this section
            if (viewportCenter >= sectionTop && viewportCenter <= sectionBottom) {
                closestIndex = index;
                closestDistance = 0;
            } else {
                // Calculate distance to section center
                const distance = Math.abs(viewportCenter - sectionCenter);
                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestIndex = index;
                }
            }
        });
        
        return closestIndex;
    }
    
    function scrollToNextSection() {
        if (mainSections.length === 0) {
            return;
        }
        
        const currentIndex = getCurrentSectionIndex();
        const nextIndex = currentIndex + 1;
        
        // If there's a next section, scroll to it
        if (nextIndex < mainSections.length) {
            const nextSection = mainSections[nextIndex];
            // Use getBoundingClientRect for absolute position (accounts for parent containers)
            const rect = nextSection.getBoundingClientRect();
            const scrollTop = window.scrollY || window.pageYOffset || document.documentElement.scrollTop;
            const offsetTop = rect.top + scrollTop - 80; // Account for sticky nav
            const targetScroll = Math.max(0, offsetTop);
            window.scrollTo({
                top: targetScroll,
                behavior: 'smooth'
            });
        } else {
            // If at last section, scroll to bottom
            window.scrollTo({
                top: document.documentElement.scrollHeight,
                behavior: 'smooth'
            });
        }
    }
    
    // Store the click handler function
    function handleClick(e) {
        e.preventDefault();
        e.stopPropagation();
        if (mainSections.length === 0) {
            return;
        }
        scrollToNextSection();
    }
    
    // Remove any existing listeners by cloning
    const newBtn = scrollDownBtn.cloneNode(true);
    scrollDownBtn.parentNode.replaceChild(newBtn, scrollDownBtn);
    
    // Add click handler
    newBtn.addEventListener('click', handleClick);
    
    // Auto-hide button when at bottom of page or last section
    function handleScroll() {
        const windowHeight = window.innerHeight;
        const documentHeight = document.documentElement.scrollHeight;
        const scrollTop = window.scrollY || window.pageYOffset || document.documentElement.scrollTop;
        
        // Check if we're at the bottom of the page
        const scrollPercent = (scrollTop + windowHeight) / documentHeight;
        const distanceFromBottom = documentHeight - (scrollTop + windowHeight);
        const isAtBottom = scrollPercent >= 0.98 || distanceFromBottom < 50;
        
        // Also check if we're in the last section
        const currentIndex = getCurrentSectionIndex();
        const isInLastSection = currentIndex >= mainSections.length - 1;
        
        const btn = document.querySelector('.scroll-down-btn');
        if (btn) {
            if (isAtBottom || isInLastSection) {
                // Hide when at bottom of page or in last section
                btn.classList.add('hidden');
            } else {
                // Show button until end of page
                btn.classList.remove('hidden');
            }
        }
    }
    
    // Throttle scroll events for better performance
    let ticking = false;
    function throttledScroll() {
        if (!ticking) {
            window.requestAnimationFrame(function() {
                handleScroll();
                ticking = false;
            });
            ticking = true;
        }
    }
    
    window.addEventListener('scroll', throttledScroll, { passive: true });
    window.addEventListener('resize', handleScroll);
    
    // Initial check on load
    handleScroll();
}

// Initialize on DOM ready - also wait a bit for dynamic content to load
function initScrollButton() {
    // Small delay to ensure all sections are rendered (especially for dynamically loaded content)
    setTimeout(() => {
        initializeScrollDownButton();
    }, 200);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initScrollButton);
} else {
    initScrollButton();
}

// Also reinitialize after a longer delay in case content loads late (like navbar)
setTimeout(() => {
    const btn = document.querySelector('.scroll-down-btn');
    if (btn && !btn.dataset.initialized) {
        btn.dataset.initialized = 'true';
        initializeScrollDownButton();
    }
}, 1000);

// Lazy load hero video with intersection observer
const heroVideoLazy = document.getElementById('hero-video');
if (heroVideoLazy) {
    // Only autoplay if user prefers motion and video is visible
    const videoObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                // Check for prefers-reduced-motion
                const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                if (!prefersReducedMotion) {
                    heroVideoLazy.play().catch(e => console.log('Video autoplay prevented:', e));
                }
            } else {
                // Pause when not visible to save bandwidth
                heroVideoLazy.pause();
            }
        });
    }, { threshold: 0.1 });
    
    videoObserver.observe(heroVideoLazy);
    
    // On mobile or if prefers-reduced-motion, don't autoplay (poster image will show)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || window.innerWidth < 768) {
        heroVideoLazy.removeAttribute('autoplay');
    } else {
        heroVideoLazy.setAttribute('autoplay', '');
    }
}


// ============================================================================
// GLOBAL SEARCH BAR - DEBUG VERSION with extensive logging
// ============================================================================

(function initSearchWhenReady() {
    function attachSearchListener() {
        const searchInput = document.querySelector('.nav-search-input');
        
        if (!searchInput) {
            return false;
        }
        
        if (searchInput.hasAttribute('data-search-ready')) {
            return true;
        }
        
        searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                const query = this.value.trim();
                if (query) {
                    window.location.href = `/search-results?q=${encodeURIComponent(query)}`;
                } else {
                    alert('Please enter a search term');
                }
            }
        });
        
        searchInput.setAttribute('data-search-ready', 'true');
        return true;
    }
    
    // Try immediately
    if (attachSearchListener()) {
        return;
    }
    
    // Watch for navbar to be added to DOM
    const observer = new MutationObserver(function(mutations) {
        if (attachSearchListener()) {
            observer.disconnect();
        }
    });
    
    // Observe the navbar placeholder
    const navbarPlaceholder = document.getElementById('navbar-placeholder');
    
    if (navbarPlaceholder) {
        observer.observe(navbarPlaceholder, {
            childList: true,
            subtree: true
        });
    } else {
        // Fallback: watch entire document
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
    
    // Safety timeout: disconnect after 5 seconds
    setTimeout(function() {
        observer.disconnect();
    }, 5000);
    
})();
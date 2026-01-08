/**
 * Curam-AI Website Scripts
 * Handles mobile menu, hero rotation, FAQ accordion, and scroll effects
 */

document.addEventListener('DOMContentLoaded', function() {
  
  // ========== MOBILE MENU TOGGLE ==========
  const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
  const navContent = document.querySelector('.nav-content');
  
  if (mobileMenuToggle && navContent) {
    mobileMenuToggle.addEventListener('click', function() {
      navContent.classList.toggle('active');
      
      // Animate hamburger to X
      const spans = mobileMenuToggle.querySelectorAll('span');
      if (navContent.classList.contains('active')) {
        spans[0].style.transform = 'rotate(45deg) translate(5px, 5px)';
        spans[1].style.opacity = '0';
        spans[2].style.transform = 'rotate(-45deg) translate(5px, -5px)';
      } else {
        spans[0].style.transform = '';
        spans[1].style.opacity = '';
        spans[2].style.transform = '';
      }
    });
    
    // Close menu when clicking outside
    document.addEventListener('click', function(e) {
      if (!e.target.closest('.navbar')) {
        navContent.classList.remove('active');
        const spans = mobileMenuToggle.querySelectorAll('span');
        spans[0].style.transform = '';
        spans[1].style.opacity = '';
        spans[2].style.transform = '';
      }
    });
  }

  // ========== HERO MESSAGE ROTATION ==========
  // Hero rotation is now handled by hero-text-rotation.js
  // This code has been moved to avoid conflicts

  // ========== NAVBAR SCROLL EFFECT ==========
  const navbar = document.querySelector('.navbar');
  
  if (navbar) {
    window.addEventListener('scroll', function() {
      if (window.scrollY > 50) {
        navbar.style.background = 'rgba(10, 22, 40, 0.98)';
        navbar.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.3)';
      } else {
        navbar.style.background = 'rgba(10, 22, 40, 0.95)';
        navbar.style.boxShadow = 'none';
      }
    });
  }

  // ========== SCROLL DOWN BUTTON ==========
  // Note: Scroll down button is now handled by main.js to avoid conflicts
  // main.js handles both click behavior and show/hide logic consistently

  // ========== FAQ ACCORDION ==========
  // Note: FAQ accordion is handled by main.js to avoid conflicts
  // This ensures consistent behavior across all pages

  // ========== SMOOTH SCROLL FOR ANCHOR LINKS ==========
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const href = this.getAttribute('href');
      if (href !== '#') {
        e.preventDefault();
        const target = document.querySelector(href);
        if (target) {
          target.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
          });
        }
      }
    });
  });

  // ========== INTERSECTION OBSERVER FOR ANIMATIONS ==========
  const observerOptions = {
    root: null,
    rootMargin: '0px',
    threshold: 0.1
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('animate-fade-up');
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  // Observe elements that should animate on scroll
  document.querySelectorAll('.protocol-phase, .product-feature-card, .selector-row').forEach(el => {
    el.style.opacity = '0';
    observer.observe(el);
  });


  // ========== INDUSTRY FINDER (No toggle - always visible) ==========
  // Industry finder is now always visible, styled like selector-grid
  // Toggle functionality removed per user request
  
  // ========== TRACK INDUSTRY FINDER VIEW ==========
  const industryFinder = document.querySelector('.industry-finder');
  if (industryFinder) {
    const finderObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          // Track that user scrolled to industry finder
          if (typeof gtag !== 'undefined') {
            gtag('event', 'industry_finder_view', {
              event_category: 'engagement',
              event_label: 'homepage'
            });
          }
          finderObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.3 });
    
    finderObserver.observe(industryFinder);
  }

});

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
  const scrollDownBtn = document.querySelector('.scroll-down-btn');
  
  if (scrollDownBtn) {
    scrollDownBtn.addEventListener('click', function() {
      const protocol = document.getElementById('protocol');
      if (protocol) {
        protocol.scrollIntoView({ behavior: 'smooth' });
      } else {
        window.scrollTo({
          top: window.innerHeight,
          behavior: 'smooth'
        });
      }
    });
    
    // Hide button after scrolling past hero
    window.addEventListener('scroll', function() {
      if (window.scrollY > window.innerHeight * 0.5) {
        scrollDownBtn.style.opacity = '0';
        scrollDownBtn.style.pointerEvents = 'none';
      } else {
        scrollDownBtn.style.opacity = '1';
        scrollDownBtn.style.pointerEvents = 'auto';
      }
    });
  }

  // ========== FAQ ACCORDION ==========
  const faqItems = document.querySelectorAll('.faq-accordion-item');
  
  faqItems.forEach(item => {
    const header = item.querySelector('.faq-accordion-header');
    
    header.addEventListener('click', function() {
      // Close all other items
      faqItems.forEach(otherItem => {
        if (otherItem !== item) {
          otherItem.classList.remove('active');
        }
      });
      
      // Toggle current item
      item.classList.toggle('active');
    });
  });

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
  document.querySelectorAll('.protocol-phase, .product-feature-card, .selector-row, .faq-accordion-item').forEach(el => {
    el.style.opacity = '0';
    observer.observe(el);
  });

  // ========== SELECTOR ROW CLICK ==========
  const selectorRows = document.querySelectorAll('.selector-row');
  
  selectorRows.forEach(row => {
    row.addEventListener('click', function() {
      const phase = this.dataset.phase;
      const protocolSection = document.getElementById('protocol');
      if (protocolSection) {
        protocolSection.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });

});

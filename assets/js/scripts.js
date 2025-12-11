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

  // ========== INDUSTRY FINDER ACCORDION ==========
  const finderCards = document.querySelectorAll('.finder-card');
  
  if (finderCards.length > 0) {
    finderCards.forEach(card => {
      const header = card.querySelector('.finder-card-header');
      const industriesDiv = card.querySelector('.finder-industries');
      const chevron = card.querySelector('.finder-chevron');
      
      if (!header || !industriesDiv) {
        return; // Skip if structure incomplete
      }
      
      // Convert chevron wrapper to button for accessibility
      let toggleButton = header.querySelector('.finder-toggle');
      if (!toggleButton && chevron) {
        // Create button wrapper for chevron
        toggleButton = document.createElement('button');
        toggleButton.className = 'finder-toggle';
        toggleButton.setAttribute('type', 'button');
        toggleButton.setAttribute('aria-expanded', 'false');
        
        const titleText = card.querySelector('.finder-title')?.textContent || 'category';
        toggleButton.setAttribute('aria-label', `Expand ${titleText} industries`);
        
        // Add ID to industries div if not present
        if (!industriesDiv.id) {
          const category = card.dataset.category || Math.random().toString(36).substr(2, 9);
          industriesDiv.id = `${category}-industries`;
        }
        toggleButton.setAttribute('aria-controls', industriesDiv.id);
        
        // Move chevron into button
        const chevronParent = chevron.parentElement;
        if (chevronParent) {
          chevronParent.replaceChild(toggleButton, chevron);
          toggleButton.appendChild(chevron);
        }
      }
      
      // Click handler for header (entire header is clickable)
      header.addEventListener('click', function(e) {
        // Don't toggle if clicking a link inside header
        if (e.target.tagName === 'A') {
          return;
        }
        
        toggleCard(card, toggleButton, industriesDiv);
      });
      
      // Keyboard support for button
      if (toggleButton) {
        toggleButton.addEventListener('keydown', function(e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleCard(card, toggleButton, industriesDiv);
          }
        });
      }
    });
    
    // Optional: Expand first card by default on desktop
    if (window.innerWidth >= 1024 && finderCards.length > 0) {
      const firstCard = finderCards[0];
      const firstButton = firstCard.querySelector('.finder-toggle');
      const firstIndustries = firstCard.querySelector('.finder-industries');
      
      if (firstButton && firstIndustries) {
        expandCard(firstCard, firstButton, firstIndustries);
      }
    }
  }
  
  // Helper function: Toggle card expanded state
  function toggleCard(card, button, industriesDiv) {
    const isExpanded = card.classList.contains('expanded');
    
    if (isExpanded) {
      collapseCard(card, button, industriesDiv);
    } else {
      expandCard(card, button, industriesDiv);
    }
  }
  
  // Helper function: Expand card
  function expandCard(card, button, industriesDiv) {
    card.classList.add('expanded');
    
    if (button) {
      button.setAttribute('aria-expanded', 'true');
    }
    
    if (industriesDiv) {
      industriesDiv.setAttribute('aria-hidden', 'false');
    }
    
    // Optional: Smooth scroll into view if partially off-screen
    setTimeout(() => {
      const rect = card.getBoundingClientRect();
      const isPartiallyVisible = rect.bottom > window.innerHeight;
      
      if (isPartiallyVisible && window.innerWidth >= 768) {
        card.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest'
        });
      }
    }, 100);
    
    // Track analytics if gtag is available
    if (typeof gtag !== 'undefined') {
      const category = card.dataset.category || 'unknown';
      gtag('event', 'industry_finder_expand', {
        event_category: 'engagement',
        event_label: category
      });
    }
  }
  
  // Helper function: Collapse card
  function collapseCard(card, button, industriesDiv) {
    card.classList.remove('expanded');
    
    if (button) {
      button.setAttribute('aria-expanded', 'false');
    }
    
    if (industriesDiv) {
      industriesDiv.setAttribute('aria-hidden', 'true');
    }
  }
  
  // Close all cards on Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      finderCards.forEach(card => {
        const button = card.querySelector('.finder-toggle');
        const industries = card.querySelector('.finder-industries');
        collapseCard(card, button, industries);
      });
    }
  });
  
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

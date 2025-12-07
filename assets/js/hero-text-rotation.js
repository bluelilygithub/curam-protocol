/**
 * Hero Text Rotation with Fade Transitions and Indicators
 * Handles smooth rotation of hero headline and description text
 */
(function() {
    'use strict';
    
    let currentSlide = 0;
    let slideInterval;
    let isPaused = false;
    const rotationSpeed = 10000; // 10 seconds per slide (content stays longer on screen)
    
    function initHeroRotation() {
        const slides = document.querySelectorAll('.hero-slide');
        const indicators = document.querySelectorAll('.hero-indicator');
        
        if (slides.length < 2) {
            // Not enough slides to rotate
            return;
        }
        
        // Initialize first slide
        updateSlide(0);
        
        // Setup indicator clicks
        indicators.forEach((indicator, index) => {
            indicator.addEventListener('click', () => {
                goToSlide(index);
            });
        });
        
        // Pause on hover
        const slidesContainer = document.querySelector('.hero-slides-container');
        if (slidesContainer) {
            slidesContainer.addEventListener('mouseenter', () => {
                isPaused = true;
                if (slideInterval) {
                    clearInterval(slideInterval);
                }
            });
            
            slidesContainer.addEventListener('mouseleave', () => {
                isPaused = false;
                startAutoRotation();
            });
        }
        
        // Start auto-rotation
        startAutoRotation();
    }
    
    function startAutoRotation() {
        if (slideInterval) {
            clearInterval(slideInterval);
        }
        
        slideInterval = setInterval(() => {
            if (!isPaused) {
                nextSlide();
            }
        }, rotationSpeed);
    }
    
    function nextSlide() {
        const slides = document.querySelectorAll('.hero-slide');
        currentSlide = (currentSlide + 1) % slides.length;
        updateSlide(currentSlide);
    }
    
    function goToSlide(index) {
        const slides = document.querySelectorAll('.hero-slide');
        if (index >= 0 && index < slides.length) {
            currentSlide = index;
            updateSlide(currentSlide);
            // Restart auto-rotation when manually changed
            startAutoRotation();
        }
    }
    
    function updateSlide(index) {
        const slides = document.querySelectorAll('.hero-slide');
        const indicators = document.querySelectorAll('.hero-indicator');
        
        // Update slides with fade transition
        slides.forEach((slide, i) => {
            if (i === index) {
                // Fade in active slide
                slide.classList.remove('fade-out');
                slide.classList.add('active', 'fade-in');
            } else {
                // Fade out inactive slides
                slide.classList.remove('active', 'fade-in');
                slide.classList.add('fade-out');
            }
        });
        
        // Update indicators
        indicators.forEach((indicator, i) => {
            if (i === index) {
                indicator.classList.add('active');
            } else {
                indicator.classList.remove('active');
            }
        });
    }
    
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initHeroRotation);
    } else {
        initHeroRotation();
    }
})();


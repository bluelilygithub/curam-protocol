/**
 * Hero Text Rotation with Fade Transitions and Indicators
 * Handles smooth rotation of hero headline and description text
 */
(function() {
    'use strict';
    
    let currentSlide = 0;
    let slideInterval;
    let isPaused = false;
    const rotationSpeed = 6000; // 6 seconds per slide (reduced by 40% from 10 seconds)
    
    function initHeroRotation() {
        const slides = document.querySelectorAll('.hero-slide');
        const statsSlides = document.querySelectorAll('.hero-stats-slide');
        const indicators = document.querySelectorAll('.hero-indicator');
        
        if (slides.length < 2) {
            // Not enough slides to rotate
            return;
        }
        
        // Ensure stats slides exist and match text slides
        if (statsSlides.length !== slides.length) {
            console.warn('Hero stats slides count does not match text slides count');
        }
        
        // Initialize first slide (both text and stats)
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
        const statsSlides = document.querySelectorAll('.hero-stats-slide');
        // Use the minimum length to ensure we don't go out of bounds
        const maxSlides = Math.min(slides.length, statsSlides.length || slides.length);
        currentSlide = (currentSlide + 1) % maxSlides;
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
        // Query elements fresh each time to ensure we have the latest DOM state
        const slides = document.querySelectorAll('.hero-slide');
        const statsSlides = document.querySelectorAll('.hero-stats-slide');
        const indicators = document.querySelectorAll('.hero-indicator');
        
        // Validate index
        if (index < 0 || index >= slides.length) {
            return;
        }
        
        // Update text slides with fade transition
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
        
        // Update stats slides with fade transition (synchronously)
        if (statsSlides.length > 0) {
            statsSlides.forEach((statsSlide, i) => {
                if (i === index) {
                    // Fade in active stats
                    statsSlide.classList.remove('fade-out');
                    statsSlide.classList.add('active', 'fade-in');
                } else {
                    // Fade out inactive stats
                    statsSlide.classList.remove('active', 'fade-in');
                    statsSlide.classList.add('fade-out');
                }
            });
        }
        
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


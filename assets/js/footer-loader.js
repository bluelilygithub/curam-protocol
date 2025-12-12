// Load footer from external file
(function() {
    const footerPlaceholder = document.getElementById('footer-placeholder');
    
    if (footerPlaceholder) {
        fetch('assets/includes/footer.html')
            .then(response => {
                if (!response.ok) {
                    throw new Error('Footer not found');
                }
                return response.text();
            })
            .then(html => {
                footerPlaceholder.outerHTML = html;
            })
            .catch(error => {
                console.error('Error loading footer:', error);
            });
    }
})();


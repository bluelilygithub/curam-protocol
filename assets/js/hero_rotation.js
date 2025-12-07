// --- Hero Message Rotation Logic ---
document.addEventListener('DOMContentLoaded', () => {
    // Collect all elements with the rotating message ID pattern
    // Dynamically find all rotating messages (supports 2 or more slides)
    const messages = [];
    let messageIndex = 1;
    let messageElement = document.getElementById(`rotating-message-${messageIndex}`);
    
    while (messageElement) {
        messages.push(messageElement);
        messageIndex++;
        messageElement = document.getElementById(`rotating-message-${messageIndex}`);
    }

    // Only proceed if we have at least 2 messages
    if (messages.length >= 2) {
        let currentIndex = 0;
        const totalMessages = messages.length;
        const rotationInterval = 6000; // Rotate every 6 seconds

        // 1. Initialize: Ensure only the first message is visible
        messages.forEach((msg, index) => {
            if (index !== 0) {
                msg.classList.add('hidden');
            } else {
                msg.classList.remove('hidden');
            }
        });

        // 2. Rotation Function with smooth transitions
        const cycleMessages = () => {
            // Hide the current message
            messages[currentIndex].classList.add('hidden');

            // Move to the next index
            currentIndex = (currentIndex + 1) % totalMessages;

            // Show the next message after a brief delay for smooth transition
            setTimeout(() => {
                messages[currentIndex].classList.remove('hidden');
            }, 100);
        };

        // 3. Start the rotation loop
        setInterval(cycleMessages, rotationInterval);
    }
});
document.addEventListener('DOMContentLoaded', () => {
    const apiKeyInput = document.getElementById('apiKey');
    const saveApiKeyBtn = document.getElementById('saveApiKey');
    const themeToggle = document.getElementById('themeToggle');
    const lightIcon = document.getElementById('lightIcon');
    const darkIcon = document.getElementById('darkIcon');

    // If we already have an API key, redirect to main page
    const savedApiKey = localStorage.getItem('apiKey');
    if (savedApiKey) {
        window.location.href = '/';
        return;
    }

    // Theme management
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
    
    function updateTheme(isDark) {
        document.documentElement.classList.toggle('dark', isDark);
        lightIcon.style.display = isDark ? 'none' : 'block';
        darkIcon.style.display = isDark ? 'block' : 'none';
    }
    
    // Initialize theme
    if (savedTheme) {
        updateTheme(savedTheme === 'dark');
    } else {
        updateTheme(prefersDark.matches);
    }
    
    // Handle theme toggle click
    themeToggle.addEventListener('click', () => {
        const isDark = !document.documentElement.classList.contains('dark');
        updateTheme(isDark);
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
    });

    // Handle Enter key in input
    apiKeyInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            saveApiKeyBtn.click();
        }
    });

    // Focus input on load
    apiKeyInput.focus();

    saveApiKeyBtn.addEventListener('click', async () => {
        const apiKey = apiKeyInput.value.trim();
        if (!apiKey) {
            showError('Please enter your API key');
            apiKeyInput.focus();
            return;
        }

        // Update button state
        const originalText = saveApiKeyBtn.textContent;
        saveApiKeyBtn.disabled = true;
        saveApiKeyBtn.innerHTML = `
            <svg class="animate-spin mr-2 inline" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            Verifying...
        `;

        try {
            // Test the API key with a simple request
            const response = await fetch('/api/getMonitoringStatus', {
                headers: {
                    'X-API-Key': apiKey
                }
            });

            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    throw new Error('Invalid API key. Please check and try again.');
                }
                throw new Error('Failed to validate API key. Please try again.');
            }

            // Show success animation before redirect
            saveApiKeyBtn.innerHTML = `
                <svg class="mr-2 inline" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M20 6L9 17l-5-5"/>
                </svg>
                Success! Redirecting...
            `;

            // If we get here, the API key is valid
            localStorage.setItem('apiKey', apiKey);
            
            // Redirect after a short delay to show success state
            setTimeout(() => {
                window.location.href = '/';
            }, 1000);
        } catch (error) {
            showError(error.message);
            saveApiKeyBtn.disabled = false;
            saveApiKeyBtn.textContent = originalText;
            apiKeyInput.focus();
        }
    });

    function showError(message) {
        // Remove any existing error message
        const existingError = document.querySelector('.error-message');
        if (existingError) {
            existingError.remove();
        }

        const errorMessage = document.createElement('div');
        errorMessage.className = 'error-message';
        errorMessage.style.animation = 'fadeIn 0.3s ease-out';
        errorMessage.innerHTML = `
            <div class="flex items-center gap-2 text-destructive mt-4 text-sm">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 8v4M12 16h.01"/>
                    <circle cx="12" cy="12" r="10"/>
                </svg>
                <span>${message}</span>
            </div>
        `;
        document.querySelector('.auth-card').appendChild(errorMessage);

        // Shake animation for input
        apiKeyInput.style.animation = 'none';
        apiKeyInput.offsetHeight; // Trigger reflow
        apiKeyInput.style.animation = 'shake 0.5s ease-in-out';
    }
});
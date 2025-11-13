// Version Checker
// Detects when UI updates are available and prompts user to refresh

'use strict';

// IMPORTANT: When updating script versions in index.html (e.g., ?v=8 → ?v=9),
// you MUST also increment this version for the toast notification to work
// Format: YYYY-MM-DD-HH (date + hour for multiple releases per day)
const CURRENT_VERSION = '2025-11-13-09'; // Add data scope and timestamp to Premium Creator Analysis

class VersionChecker {
    constructor() {
        this.storageKey = 'dubAnalyticsVersion';
        this.toastShown = false;
        this.checkIntervalMs = 30000; // Check every 30 seconds
    }

    /**
     * Start periodic version checking
     */
    startPeriodicCheck() {
        // Initial check
        this.checkVersion();

        // Check periodically
        this.intervalId = setInterval(() => {
            this.checkVersionFromServer();
        }, this.checkIntervalMs);

        console.log(`🔄 Version checker started (checking every ${this.checkIntervalMs / 1000}s)`);
    }

    /**
     * Check version by fetching the version-checker.js file from server
     * This detects changes even while the page is open
     */
    async checkVersionFromServer() {
        if (this.toastShown) return; // Already notified

        try {
            // Fetch version-checker.js with cache-busting timestamp
            const response = await fetch(`version-checker.js?t=${Date.now()}`);
            const content = await response.text();

            // Extract CURRENT_VERSION from the file
            const match = content.match(/const CURRENT_VERSION = ['"]([^'"]+)['"]/);
            if (match && match[1]) {
                const serverVersion = match[1];
                const cachedVersion = localStorage.getItem(this.storageKey);

                if (cachedVersion && cachedVersion !== serverVersion) {
                    console.log(`📦 Version update detected: cached=${cachedVersion}, server=${serverVersion}`);
                    this.showUpdateNotification();
                    clearInterval(this.intervalId); // Stop checking once notified
                }
            }
        } catch (error) {
            console.error('Error checking version from server:', error);
        }
    }

    /**
     * Check if the user's cached version matches the current deployed version
     * If mismatch, show update notification
     */
    checkVersion() {
        const cachedVersion = localStorage.getItem(this.storageKey);

        if (cachedVersion && cachedVersion !== CURRENT_VERSION) {
            console.log(`📦 Version mismatch detected: cached=${cachedVersion}, current=${CURRENT_VERSION}`);
            this.showUpdateNotification();
        } else if (!cachedVersion) {
            // First time visitor - save current version
            console.log(`📦 First visit - saving version ${CURRENT_VERSION}`);
            localStorage.setItem(this.storageKey, CURRENT_VERSION);
        } else {
            console.log(`✅ Version up to date: ${CURRENT_VERSION}`);
        }
    }

    /**
     * Show update notification toast in bottom right corner
     */
    showUpdateNotification() {
        if (this.toastShown) return; // Prevent duplicates
        this.toastShown = true;

        // Create toast container
        const toast = document.createElement('div');
        toast.className = 'version-update-toast';
        toast.innerHTML = `
            <div class="toast-content">
                <div class="toast-icon">🔄</div>
                <div class="toast-text">
                    <div class="toast-title">New Updates Available</div>
                    <div class="toast-message">Click "Refresh" to see the latest updates</div>
                </div>
                <button class="toast-refresh-btn">Refresh</button>
                <button class="toast-dismiss-btn">×</button>
            </div>
        `;

        // Add styles
        this.injectStyles();

        // Add to page
        document.body.appendChild(toast);

        // Animate in
        setTimeout(() => {
            toast.classList.add('show');
        }, 100);

        // Add event listeners
        const refreshBtn = toast.querySelector('.toast-refresh-btn');
        const dismissBtn = toast.querySelector('.toast-dismiss-btn');

        refreshBtn.addEventListener('click', () => {
            this.refreshPage();
        });

        dismissBtn.addEventListener('click', () => {
            this.dismissToast(toast);
        });
    }

    /**
     * Refresh the page and update stored version
     */
    refreshPage() {
        console.log(`🔄 Refreshing page to version ${CURRENT_VERSION}`);

        // Update version
        localStorage.setItem(this.storageKey, CURRENT_VERSION);

        // Hard refresh to load new UI code
        // Cache will be restored normally on page load
        window.location.reload(true);
    }

    /**
     * Dismiss the toast notification
     */
    dismissToast(toast) {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
            this.toastShown = false;
        }, 300);
    }

    /**
     * Inject CSS styles for the toast notification
     */
    injectStyles() {
        if (document.getElementById('version-checker-styles')) return; // Already injected

        const style = document.createElement('style');
        style.id = 'version-checker-styles';
        style.textContent = `
            .version-update-toast {
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: white;
                border-radius: 12px;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
                padding: 16px;
                max-width: 380px;
                z-index: 10000;
                opacity: 0;
                transform: translateY(20px);
                transition: opacity 0.3s ease, transform 0.3s ease;
                border: 1px solid #e5e7eb;
            }

            .version-update-toast.show {
                opacity: 1;
                transform: translateY(0);
            }

            .toast-content {
                display: flex;
                align-items: center;
                gap: 12px;
            }

            .toast-icon {
                font-size: 28px;
                flex-shrink: 0;
            }

            .toast-text {
                flex: 1;
            }

            .toast-title {
                font-weight: 600;
                font-size: 14px;
                color: #111827;
                margin-bottom: 4px;
            }

            .toast-message {
                font-size: 13px;
                color: #6b7280;
                line-height: 1.4;
            }

            .toast-refresh-btn {
                background: #2563eb;
                color: white;
                border: none;
                padding: 8px 16px;
                border-radius: 6px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                flex-shrink: 0;
                transition: background 0.2s ease;
            }

            .toast-refresh-btn:hover {
                background: #1d4ed8;
            }

            .toast-refresh-btn:active {
                transform: scale(0.98);
            }

            .toast-dismiss-btn {
                background: transparent;
                border: none;
                color: #9ca3af;
                font-size: 24px;
                cursor: pointer;
                padding: 0 4px;
                line-height: 1;
                flex-shrink: 0;
                transition: color 0.2s ease;
            }

            .toast-dismiss-btn:hover {
                color: #6b7280;
            }

            /* Mobile responsive */
            @media (max-width: 480px) {
                .version-update-toast {
                    bottom: 10px;
                    right: 10px;
                    left: 10px;
                    max-width: none;
                }

                .toast-content {
                    flex-wrap: wrap;
                }

                .toast-refresh-btn {
                    width: 100%;
                    margin-top: 8px;
                }
            }
        `;
        document.head.appendChild(style);
    }
}

// Initialize version checker when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        const checker = new VersionChecker();
        checker.startPeriodicCheck();
    });
} else {
    const checker = new VersionChecker();
    checker.startPeriodicCheck();
}

console.log('✅ Version Checker loaded successfully!');

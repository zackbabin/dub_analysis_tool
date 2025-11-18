// Version Checker
// Tracks UI version for cache busting - no notifications needed since Refresh Data button handles updates

'use strict';

// IMPORTANT: When making UI changes, increment BOTH:
// 1. This CURRENT_VERSION constant (for version detection)
// 2. All ?v=X parameters in index.html script tags (for cache busting)
// Format: YYYY-MM-DD-HH (date + hour for multiple releases per day)
const CURRENT_VERSION = '2025-11-18-21'; // Remove toast notification - Refresh Data button handles UI updates

class VersionChecker {
    constructor() {
        this.storageKey = 'dubAnalyticsVersion';
    }

    /**
     * Check and update version in localStorage
     * Logs version changes but no UI notifications needed
     */
    checkVersion() {
        const cachedVersion = localStorage.getItem(this.storageKey);

        if (!cachedVersion) {
            // First time visitor - save current version
            console.log(`📦 First visit - saving version ${CURRENT_VERSION}`);
            localStorage.setItem(this.storageKey, CURRENT_VERSION);
        } else if (cachedVersion !== CURRENT_VERSION) {
            console.log(`📦 Version updated: ${cachedVersion} → ${CURRENT_VERSION}`);
            console.log(`ℹ️ Use "Refresh Data" button to reload from database`);
            // Update stored version
            localStorage.setItem(this.storageKey, CURRENT_VERSION);
        } else {
            console.log(`✅ Version up to date: ${CURRENT_VERSION}`);
        }
    }
}

// Initialize version checker when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        const checker = new VersionChecker();
        checker.checkVersion();
    });
} else {
    const checker = new VersionChecker();
    checker.checkVersion();
}

console.log('✅ Version Checker loaded successfully!');

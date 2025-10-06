/**
 * CSV Parsing Utilities
 * Centralized CSV parsing functions used across analysis tools
 */

/**
 * Parse CSV text into structured data
 * @param {string} text - Raw CSV text content
 * @param {Object} options - Parsing options
 * @param {boolean} options.skipEmpty - Skip empty lines (default: true)
 * @param {string} options.delimiter - Column delimiter (default: ',')
 * @returns {Object} - { headers: string[], data: Object[] }
 */
function parseCSV(text, options = {}) {
    const { skipEmpty = true, delimiter = ',' } = options;

    // Split into lines and optionally filter empty
    const lines = text.split('\n');
    const filteredLines = skipEmpty ? lines.filter(l => l.trim()) : lines;

    if (filteredLines.length === 0) {
        return { headers: [], data: [] };
    }

    // Parse headers
    const headers = filteredLines[0]
        .split(delimiter)
        .map(h => h.trim().replace(/"/g, ''));

    // Parse data rows
    const data = filteredLines.slice(1).map(line => {
        const values = line.split(delimiter);
        const row = {};
        headers.forEach((h, i) => {
            row[h] = values[i] ? values[i].trim().replace(/"/g, '') : '';
        });
        return row;
    });

    return { headers, data };
}

/**
 * Parse only CSV headers (first line)
 * Useful for file type detection without parsing full content
 * @param {string} text - Raw CSV text content
 * @param {Object} options - Parsing options
 * @param {number} options.maxLines - Maximum lines to read (default: 1)
 * @param {string} options.delimiter - Column delimiter (default: ',')
 * @returns {string[]} - Array of header names
 */
function parseCSVHeaders(text, options = {}) {
    const { maxLines = 1, delimiter = ',' } = options;

    const lines = text.split('\n').slice(0, maxLines);
    if (lines.length === 0 || !lines[0]) {
        return [];
    }

    return lines[0]
        .split(delimiter)
        .map(h => h.trim().replace(/"/g, ''));
}

/**
 * Peek at CSV structure without full parsing
 * Returns headers and preview of first few rows
 * @param {string} text - Raw CSV text content
 * @param {Object} options - Parsing options
 * @param {number} options.previewRows - Number of data rows to preview (default: 3)
 * @param {string} options.delimiter - Column delimiter (default: ',')
 * @returns {Object} - { headers: string[], preview: string[][], totalLines: number }
 */
function peekCSV(text, options = {}) {
    const { previewRows = 3, delimiter = ',' } = options;

    const lines = text.split('\n').filter(l => l.trim());

    if (lines.length === 0) {
        return { headers: [], preview: [], totalLines: 0 };
    }

    const headers = lines[0]
        .split(delimiter)
        .map(h => h.trim().replace(/"/g, ''));

    const preview = lines.slice(1, previewRows + 1).map(line =>
        line.split(delimiter).map(v => v.trim().replace(/"/g, ''))
    );

    return {
        headers,
        preview,
        totalLines: lines.length - 1 // Exclude header
    };
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.CSVUtils = {
        parseCSV,
        parseCSVHeaders,
        peekCSV
    };
}

console.log('✅ CSV Utilities loaded');

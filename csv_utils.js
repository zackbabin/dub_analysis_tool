/**
 * CSV Parsing Utilities
 * Centralized CSV parsing functions used across analysis tools
 */

/**
 * Parse a single CSV line, properly handling quoted fields with commas
 * @param {string} line - CSV line to parse
 * @param {string} delimiter - Column delimiter (default: ',')
 * @returns {string[]} - Array of field values
 */
function parseCSVLine(line, delimiter = ',') {
    const fields = [];
    let current = '';
    let inQuotes = false;
    let i = 0;

    while (i < line.length) {
        const char = line[i];
        const nextChar = line[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                // Escaped quote
                current += '"';
                i += 2;
                continue;
            } else {
                // Toggle quote state
                inQuotes = !inQuotes;
                i++;
                continue;
            }
        }

        if (char === delimiter && !inQuotes) {
            // End of field
            fields.push(current.trim());
            current = '';
            i++;
            continue;
        }

        // Regular character
        current += char;
        i++;
    }

    // Add the last field
    fields.push(current.trim());

    return fields;
}

/**
 * Parse CSV text into structured data, handling multiline quoted fields
 * @param {string} text - Raw CSV text content
 * @param {Object} options - Parsing options
 * @param {boolean} options.skipEmpty - Skip empty lines (default: true)
 * @param {string} options.delimiter - Column delimiter (default: ',')
 * @returns {Object} - { headers: string[], data: Object[] }
 */
function parseCSV(text, options = {}) {
    const { delimiter = ',' } = options;

    // Parse CSV respecting quoted fields that may contain newlines
    const rows = [];
    let currentRow = [];
    let currentField = '';
    let inQuotes = false;
    let i = 0;

    while (i < text.length) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                // Escaped quote
                currentField += '"';
                i += 2;
                continue;
            } else {
                // Toggle quote state
                inQuotes = !inQuotes;
                i++;
                continue;
            }
        }

        if (char === delimiter && !inQuotes) {
            // End of field
            currentRow.push(currentField.trim());
            currentField = '';
            i++;
            continue;
        }

        if ((char === '\n' || char === '\r') && !inQuotes) {
            // End of row
            if (currentField || currentRow.length > 0) {
                currentRow.push(currentField.trim());
                if (currentRow.some(f => f)) { // Only add non-empty rows
                    rows.push(currentRow);
                }
                currentRow = [];
                currentField = '';
            }
            // Skip \r\n combination
            if (char === '\r' && nextChar === '\n') {
                i += 2;
            } else {
                i++;
            }
            continue;
        }

        // Regular character (including newlines within quotes)
        currentField += char;
        i++;
    }

    // Add final field and row
    if (currentField || currentRow.length > 0) {
        currentRow.push(currentField.trim());
        if (currentRow.some(f => f)) {
            rows.push(currentRow);
        }
    }

    if (rows.length === 0) {
        return { headers: [], data: [] };
    }

    // First row is headers
    const headers = rows[0];

    // Convert remaining rows to objects
    const data = rows.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, i) => {
            obj[h] = row[i] || '';
        });
        return obj;
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

    return parseCSVLine(lines[0], delimiter);
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

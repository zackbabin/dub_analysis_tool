// Shared CSV parsing utilities
// Used across Edge Functions for consistent CSV handling

/**
 * Parses CSV content into an array of objects
 * @param csvContent - Raw CSV string content
 * @returns Array of objects where keys are column headers
 */
export function parseCSV(csvContent: string): any[] {
  const lines = splitCSVIntoLines(csvContent.trim())
  if (lines.length === 0) return []

  const headers = parseCSVLine(lines[0])
  const data: any[] = []

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i])
    if (values.length === 0) continue

    // Skip rows where the number of values doesn't match headers
    // This prevents misaligned data from being inserted
    if (values.length !== headers.length) {
      console.warn(`Skipping row ${i}: expected ${headers.length} columns, got ${values.length}`)
      continue
    }

    const row: any = {}
    headers.forEach((header, index) => {
      row[header] = values[index] || ''
    })
    data.push(row)
  }

  return data
}

/**
 * Splits CSV content into individual lines while respecting quoted fields
 * Handles both Unix (\n) and Windows (\r\n) line endings
 * @param csvContent - Raw CSV string content
 * @returns Array of CSV lines
 */
function splitCSVIntoLines(csvContent: string): string[] {
  const lines: string[] = []
  let currentLine = ''
  let inQuotes = false

  for (let i = 0; i < csvContent.length; i++) {
    const char = csvContent[i]

    if (char === '"') {
      currentLine += char
      // Check for escaped quotes
      if (inQuotes && csvContent[i + 1] === '"') {
        currentLine += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === '\n' && !inQuotes) {
      if (currentLine.trim()) {
        lines.push(currentLine)
      }
      currentLine = ''
    } else if (char === '\r' && csvContent[i + 1] === '\n' && !inQuotes) {
      // Handle Windows line endings (\r\n)
      if (currentLine.trim()) {
        lines.push(currentLine)
      }
      currentLine = ''
      i++ // Skip the \n
    } else {
      currentLine += char
    }
  }

  // Add the last line if it exists
  if (currentLine.trim()) {
    lines.push(currentLine)
  }

  return lines
}

/**
 * Parses a single CSV line into an array of values
 * Handles quoted fields and escaped quotes
 * @param line - Single CSV line string
 * @returns Array of field values
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }

  result.push(current.trim())
  return result
}

/**
 * Converts a string to camelCase
 * @param str - String to convert
 * @returns camelCase version of the string
 */
export function toCamelCase(str: string): string {
  return str
    .replace(/[:\s-]+(.)?/g, (_, char) => char ? char.toUpperCase() : '')
    .replace(/^(.)/, (char) => char.toLowerCase())
}

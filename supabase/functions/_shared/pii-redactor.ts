/**
 * PII Redaction Utility
 *
 * Redacts sensitive personally identifiable information (PII) from text and objects
 * before storing in database.
 *
 * Redacts:
 * - Social Security Numbers (SSN)
 * - Credit Card Numbers
 * - Phone Numbers
 * - Email Addresses (except preserved emails for user matching)
 * - Bank Account Numbers
 * - Physical Addresses
 *
 * Used by: sync-support-conversations edge function
 */

export class PIIRedactor {
  private static patterns = {
    // SSN: 123-45-6789 or 123456789
    ssn: /\b\d{3}-\d{2}-\d{4}\b|\b\d{9}\b/g,

    // Credit Card: 1234-5678-9012-3456 or 1234 5678 9012 3456 or 1234567890123456
    creditCard: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,

    // Phone: +1-234-567-8900, (234) 567-8900, 234-567-8900, 234.567.8900
    phone: /\b(\+\d{1,2}\s?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,

    // Email: user@example.com
    email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,

    // Bank Account: 8-17 digit numbers (common range)
    bankAccount: /\b\d{8,17}\b/g,

    // Address: Street number + street name with common suffixes
    address: /\b\d+\s+[A-Za-z0-9\s,]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Circle|Cir|Way)\b/gi,
  }

  /**
   * Redact PII from text string
   * @param text - Text to redact
   * @param preserveEmail - Email address to preserve (for user matching)
   * @returns Redacted text
   */
  static redact(text: string, preserveEmail?: string): string {
    if (!text) return text

    let redacted = text

    // Redact SSNs
    redacted = redacted.replace(this.patterns.ssn, '[SSN REDACTED]')

    // Redact credit cards
    redacted = redacted.replace(this.patterns.creditCard, '[CREDIT CARD REDACTED]')

    // Redact phone numbers
    redacted = redacted.replace(this.patterns.phone, '[PHONE REDACTED]')

    // Redact bank account numbers (8-17 digits, common range)
    // Avoid false positives for dates, IDs, etc.
    redacted = redacted.replace(this.patterns.bankAccount, (match) => {
      if (match.length >= 10) {
        return '[BANK ACCOUNT REDACTED]'
      }
      return match
    })

    // Redact addresses
    redacted = redacted.replace(this.patterns.address, '[ADDRESS REDACTED]')

    // Redact emails except the preserved one (user_email for matching)
    if (preserveEmail) {
      redacted = redacted.replace(this.patterns.email, (match) => {
        return match.toLowerCase() === preserveEmail.toLowerCase()
          ? match
          : '[EMAIL REDACTED]'
      })
    } else {
      redacted = redacted.replace(this.patterns.email, '[EMAIL REDACTED]')
    }

    return redacted
  }

  /**
   * Recursively redact PII from objects and arrays
   * @param obj - Object or array to redact
   * @param preserveEmail - Email address to preserve
   * @returns Redacted object/array
   */
  static redactObject(obj: any, preserveEmail?: string): any {
    if (!obj) return obj

    if (typeof obj === 'string') {
      return this.redact(obj, preserveEmail)
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.redactObject(item, preserveEmail))
    }

    if (typeof obj === 'object') {
      const redacted: any = {}
      for (const [key, value] of Object.entries(obj)) {
        redacted[key] = this.redactObject(value, preserveEmail)
      }
      return redacted
    }

    return obj
  }
}

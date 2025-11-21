/**
 * Support Data Normalizers
 *
 * Normalizes data from Zendesk and Instabug into a common schema
 * and applies PII redaction during transformation.
 *
 * Used by: sync-support-conversations edge function
 */

import { PIIRedactor } from './pii-redactor.ts'

export interface ConversationRecord {
  id: string // Source ticket ID (Zendesk ticket.id, Instabug bug.id)
  source: string
  title: string | null
  description: string | null
  status: string
  priority: string
  created_at: string
  updated_at: string | null
  resolved_at: string | null
  user_uuid: string | null // Will be populated after matching distinct_id
  user_id: string | null // Mixpanel distinct_id (from Zendesk ticket.external_id or Instabug user.id)
  assignee_id: string | null
  tags: string[]
  custom_fields: Record<string, any>
  raw_data: Record<string, any>
  // Linear integration fields
  has_linear_ticket: boolean
  linear_issue_id: string | null
  linear_custom_field_id: string | null
}

export interface MessageRecord {
  conversation_source: string // Source (zendesk, instabug)
  conversation_id: string // Ticket ID from raw_support_conversations.id
  external_id: string | null // Zendesk comment ID or Instabug comment ID (for deduplication)
  author_type: string
  author_id: string | null
  author_email: string | null
  body: string
  is_public: boolean
  created_at: string
  raw_data: Record<string, any>
}

/**
 * Conversation Normalizer
 * Transforms Zendesk tickets and Instabug bugs into normalized schema
 */
export class ConversationNormalizer {
  /**
   * Normalize Zendesk ticket to common schema with PII redaction
   *
   * ID Mapping:
   * - ticket.id → our id (PRIMARY KEY)
   * - ticket.external_id → our user_id (Mixpanel distinct_id)
   */
  static normalizeZendeskTicket(ticket: any): ConversationRecord {
    // Extract Mixpanel distinct_id from Zendesk's external_id field
    const distinctId = ticket.external_id || null

    // Extract Linear metadata
    // 1. Check for "linear_ticket" tag
    const tags = ticket.tags || []
    const hasLinearTag = tags.includes('linear_ticket')

    // 2. Check custom fields for Linear issue ID (format: "DUB-123")
    const customFields = ticket.custom_fields || []
    let linearIssueId: string | null = null
    let linearCustomFieldId: string | null = null

    // Look for a custom field containing a Linear-style issue ID
    for (const field of customFields) {
      const value = field.value
      if (value && typeof value === 'string') {
        // Match pattern: DUB-XXX or other uppercase prefix followed by dash and number
        const linearPattern = /^[A-Z]+-\d+$/
        if (linearPattern.test(value)) {
          linearIssueId = value
          linearCustomFieldId = field.id?.toString() || null
          break
        }
      }
    }

    return {
      id: ticket.id.toString(), // Zendesk ticket ID
      source: 'zendesk',
      title: PIIRedactor.redact(ticket.subject, distinctId),
      description: PIIRedactor.redact(ticket.description, distinctId),
      status: ticket.status,
      priority: ticket.priority || 'normal',
      created_at: ticket.created_at,
      updated_at: ticket.updated_at,
      resolved_at: ticket.solved_at,
      user_uuid: null, // Will be populated by database lookup
      user_id: distinctId, // Mixpanel distinct_id from Zendesk ticket.external_id
      assignee_id: ticket.assignee_id?.toString(),
      tags: tags,
      custom_fields: PIIRedactor.redactObject(customFields, distinctId),
      raw_data: PIIRedactor.redactObject(ticket, distinctId),
      // Linear integration
      has_linear_ticket: hasLinearTag || linearIssueId !== null,
      linear_issue_id: linearIssueId,
      linear_custom_field_id: linearCustomFieldId,
    }
  }

  /**
   * Normalize Zendesk comment to common schema with PII redaction
   * @param comment - Zendesk comment object
   * @param ticketId - Zendesk ticket ID (from raw_support_conversations.id)
   * @param userDistinctId - Mixpanel distinct_id for PII redaction
   */
  static normalizeZendeskComment(
    comment: any,
    ticketId: string,
    userDistinctId?: string
  ): MessageRecord {
    return {
      conversation_source: 'zendesk',
      conversation_id: ticketId,
      external_id: comment.id?.toString(),
      author_type: comment.author_id ? 'agent' : 'customer',
      author_id: comment.author_id?.toString(),
      author_email: comment.author_email || null,
      body: PIIRedactor.redact(comment.body || comment.plain_body || '', userDistinctId),
      is_public: comment.public !== false,
      created_at: comment.created_at,
      raw_data: PIIRedactor.redactObject(comment, userDistinctId),
    }
  }

  /**
   * Normalize Instabug bug to common schema with PII redaction
   *
   * ID Mapping:
   * - bug.id → our id (PRIMARY KEY)
   * - bug.user.id → our user_id (Mixpanel distinct_id)
   */
  static normalizeInstabugBug(bug: any): ConversationRecord {
    // Extract Mixpanel distinct_id from Instabug user.id field
    const distinctId = bug.user?.id?.toString() || null

    return {
      id: bug.id.toString(), // Instabug bug ID
      source: 'instabug',
      title: PIIRedactor.redact(bug.title || 'Untitled Bug', distinctId),
      description: PIIRedactor.redact(bug.description || '', distinctId),
      status: bug.state || 'open',
      priority: bug.priority || 'medium',
      created_at: bug.created_at,
      updated_at: bug.updated_at,
      resolved_at: bug.resolved_at,
      user_uuid: null, // Will be populated by database lookup
      user_id: distinctId, // Mixpanel distinct_id from Instabug user.id
      assignee_id: bug.assignee?.id?.toString(),
      tags: bug.tags || [],
      custom_fields: {
        device: bug.device,
        os_version: bug.os_version,
        app_version: bug.app_version,
        console_logs: PIIRedactor.redact(bug.console_logs, distinctId),
        network_logs: PIIRedactor.redactObject(bug.network_logs, distinctId),
      },
      raw_data: PIIRedactor.redactObject(bug, distinctId),
      // Linear integration (Instabug doesn't have Linear integration)
      has_linear_ticket: false,
      linear_issue_id: null,
      linear_custom_field_id: null,
    }
  }

  /**
   * Normalize Instabug comment to common schema with PII redaction
   * @param comment - Instabug comment object
   * @param bugId - Instabug bug ID (from raw_support_conversations.id)
   * @param userDistinctId - Mixpanel distinct_id for PII redaction
   */
  static normalizeInstabugComment(
    comment: any,
    bugId: string,
    userDistinctId?: string
  ): MessageRecord {
    return {
      conversation_source: 'instabug',
      conversation_id: bugId,
      external_id: comment.id?.toString(),
      author_type: comment.user_type || 'customer',
      author_id: comment.user?.id?.toString(),
      author_email: comment.user?.email || null,
      body: PIIRedactor.redact(comment.body || '', userDistinctId),
      is_public: true,
      created_at: comment.created_at,
      raw_data: PIIRedactor.redactObject(comment, userDistinctId),
    }
  }
}

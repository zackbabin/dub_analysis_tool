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
  source: string
  external_id: string
  title: string | null
  description: string | null
  status: string
  priority: string
  created_at: string
  updated_at: string | null
  resolved_at: string | null
  user_uuid: string | null // Will be populated after matching distinct_id
  user_id: string | null // distinct_id from source system (Zendesk external_id or Instabug user_id)
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
  conversation_external_id: string
  external_id: string | null
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
   * Maps Zendesk external_id to user_id for distinct_id matching
   * Extracts Linear integration metadata from tags and custom fields
   */
  static normalizeZendeskTicket(ticket: any): ConversationRecord {
    // Extract distinct_id from Zendesk external_id field (maps to Mixpanel distinct_id)
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
      source: 'zendesk',
      external_id: ticket.id.toString(),
      title: PIIRedactor.redact(ticket.subject, distinctId),
      description: PIIRedactor.redact(ticket.description, distinctId),
      status: ticket.status,
      priority: ticket.priority || 'normal',
      created_at: ticket.created_at,
      updated_at: ticket.updated_at,
      resolved_at: ticket.solved_at,
      user_uuid: null, // Will be populated by database lookup
      user_id: distinctId, // Zendesk external_id maps to distinct_id
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
   */
  static normalizeZendeskComment(
    comment: any,
    ticketId: string,
    userDistinctId?: string
  ): MessageRecord {
    return {
      conversation_external_id: ticketId.toString(),
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
   * Maps Instabug user_id to user_id for distinct_id matching
   */
  static normalizeInstabugBug(bug: any): ConversationRecord {
    // Extract distinct_id from Instabug user.id field (maps to Mixpanel distinct_id)
    const distinctId = bug.user?.id?.toString() || null

    return {
      source: 'instabug',
      external_id: bug.id.toString(),
      title: PIIRedactor.redact(bug.title || 'Untitled Bug', distinctId),
      description: PIIRedactor.redact(bug.description || '', distinctId),
      status: bug.state || 'open',
      priority: bug.priority || 'medium',
      created_at: bug.created_at,
      updated_at: bug.updated_at,
      resolved_at: bug.resolved_at,
      user_uuid: null, // Will be populated by database lookup
      user_id: distinctId, // Instabug user.id maps to distinct_id
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
   */
  static normalizeInstabugComment(
    comment: any,
    bugId: string,
    userDistinctId?: string
  ): MessageRecord {
    return {
      conversation_external_id: bugId.toString(),
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

export interface GmailMessagePart {
  mimeType: string;
  body?: {
    data?: string;
    size: number;
  };
  parts?: GmailMessagePart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  payload: {
    headers: Array<{
      name: string;
      value: string;
    }>;
    mimeType: string;
    body?: {
      data?: string;
      size: number;
    };
    parts?: GmailMessagePart[];
  };
  internalDate: string;
}

export interface ParsedEmail {
  id: string;
  threadId: string;
  from: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  bodyText: string;
  bodyHtml: string;
  date: Date;
  isUnread: boolean;
  isStarred: boolean;
  isImportant: boolean;
  labels: string[];
}

export interface SenderGroup {
  senderEmail: string;
  senderName: string;
  emails: ParsedEmail[];
}

export interface GmailListResponse {
  messages: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate: number;
}

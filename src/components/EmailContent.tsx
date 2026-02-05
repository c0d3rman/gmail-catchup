import { useMemo } from 'react';
import type { ParsedEmail } from '../types/gmail';
import { extractReaderContent } from '../services/gmail';
import styles from './EmailContent.module.css';

interface EmailContentProps {
  email: ParsedEmail;
  readerView: boolean;
}

export function EmailContent({ email, readerView }: EmailContentProps) {
  const content = useMemo(() => {
    if (readerView) {
      // Reader view: extract clean text
      if (email.bodyHtml) {
        return { type: 'text' as const, content: extractReaderContent(email.bodyHtml) };
      }
      return { type: 'text' as const, content: cleanTextContent(email.bodyText) };
    }

    // Full view: prefer HTML
    if (email.bodyHtml) {
      return { type: 'html' as const, content: sanitizeHtml(email.bodyHtml) };
    }

    return { type: 'text' as const, content: email.bodyText };
  }, [email, readerView]);

  if (content.type === 'html') {
    return (
      <div
        className={styles.htmlContent}
        dangerouslySetInnerHTML={{ __html: content.content }}
      />
    );
  }

  return (
    <div className={styles.textContent}>
      {content.content}
    </div>
  );
}

function cleanTextContent(text: string): string {
  // Remove common footer patterns from plain text
  const patterns = [
    /^-{2,}\s*Forwarded message\s*-{2,}[\s\S]*?(?=\n\n)/gim,
    /^From:.*\nSent:.*\nTo:.*\nSubject:.*\n/gim,
    /^Sent from my (?:iPhone|iPad|Android|Samsung|Pixel).*$/gim,
    /^Get Outlook for (?:iOS|Android).*$/gim,
    /_{10,}/g,
    /-{10,}/g,
    /This email and any attachments.*$/gis,
    /CONFIDENTIALITY NOTICE.*$/gis,
    /\[cid:[^\]]+\]/g,
  ];

  let clean = text;
  patterns.forEach(pattern => {
    clean = clean.replace(pattern, '');
  });

  return clean.replace(/\n{3,}/g, '\n\n').trim();
}

function sanitizeHtml(html: string): string {
  // Basic sanitization - remove scripts, on* attributes
  let sanitized = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '');

  // Fix relative image URLs (won't work, but prevents broken images)
  // Keep data: URLs and absolute URLs
  sanitized = sanitized.replace(
    /src=["'](?!data:|https?:\/\/)([^"']+)["']/gi,
    'src=""'
  );

  // Add target="_blank" to all links
  sanitized = sanitized.replace(
    /<a\s/gi,
    '<a target="_blank" rel="noopener noreferrer" '
  );

  return sanitized;
}

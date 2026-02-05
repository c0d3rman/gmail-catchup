import { useMemo, useRef, useEffect, useState } from 'react';
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
    return <HtmlIframe html={content.content} />;
  }

  return (
    <div className={styles.textContent}>
      {content.content}
    </div>
  );
}

function HtmlIframe({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);

  const srcdoc = useMemo(() => {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="only light"><style>
body{margin:0;padding:16px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:14px;line-height:1.6;color:#222;background:#fff;word-wrap:break-word;overflow-wrap:break-word;overflow:hidden}
img{max-width:100%!important;height:auto!important}
a{color:#1a73e8}
table{max-width:100%!important}
*{max-width:100%!important;box-sizing:border-box}
blockquote{margin:8px 0;padding-left:12px;border-left:3px solid #ccc;color:#666}
pre,code{background:#f5f5f5;padding:2px 6px;border-radius:4px;font-family:monospace;font-size:13px}
pre{padding:12px;overflow-x:auto}
</style></head><body>${html}</body></html>`;
  }, [html]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    let observer: ResizeObserver | null = null;

    const updateHeight = () => {
      try {
        const doc = iframe.contentDocument;
        if (doc) {
          const h = doc.documentElement.scrollHeight;
          setHeight(h);
        }
      } catch {
        // cross-origin, ignore
      }
    };

    const handleLoad = () => {
      updateHeight();

      // Watch for layout changes inside the iframe (images loading, fonts, etc.)
      try {
        const doc = iframe.contentDocument;
        if (doc?.body) {
          observer = new ResizeObserver(updateHeight);
          observer.observe(doc.body);
        }
      } catch {
        // cross-origin, ignore
      }
    };

    iframe.addEventListener('load', handleLoad);
    return () => {
      iframe.removeEventListener('load', handleLoad);
      observer?.disconnect();
    };
  }, [srcdoc]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcdoc}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      scrolling="no"
      className={styles.htmlIframe}
      style={{ height }}
      title="Email content"
    />
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

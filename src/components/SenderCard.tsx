import { useState, useRef, useEffect } from 'react';
import { motion, useAnimation, type PanInfo } from 'framer-motion';
import { formatDistanceToNow, format } from 'date-fns';
import type { SenderGroup, ParsedEmail } from '../types/gmail';
import { EmailContent } from './EmailContent';
import styles from './SenderCard.module.css';

interface SenderCardProps {
  group: SenderGroup;
  onSkip: () => void;
  onMarkAsRead: () => void;
  onTodo: () => void;
  onUndo?: () => void;
  onEmailAction: (emailId: string, action: 'read' | 'skip' | 'todo') => void;
}

type ViewMode = 'single' | 'card' | 'table';

function getViewMode(emailCount: number): ViewMode {
  if (emailCount === 1) return 'single';
  if (emailCount <= 5) return 'card';
  return 'table';
}

function getGmailUrl(messageId: string): string {
  return `https://mail.google.com/mail/u/0/#inbox/${messageId}`;
}

function getReplyUrl(messageId: string): string {
  return `https://mail.google.com/mail/u/0/#inbox/${messageId}?compose=new`;
}

export function SenderCard({ group, onSkip, onMarkAsRead, onTodo, onUndo, onEmailAction }: SenderCardProps) {
  const [expandedEmailId, setExpandedEmailId] = useState<string | null>(
    group.emails.length === 1 ? group.emails[0].id : null
  );
  const [readerView, setReaderView] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | 'down' | null>(null);
  const controls = useAnimation();
  const cardRef = useRef<HTMLDivElement>(null);
  const viewMode = getViewMode(group.emails.length);

  useEffect(() => {
    controls.start({ scale: 1, opacity: 1, x: 0, y: 0 });
  }, [controls]);

  const handleDrag = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const { offset } = info;
    if (Math.abs(offset.y) > Math.abs(offset.x) && offset.y > 30) {
      setSwipeDirection('down');
    } else if (offset.x > 30) {
      setSwipeDirection('right');
    } else if (offset.x < -30) {
      setSwipeDirection('left');
    } else {
      setSwipeDirection(null);
    }
  };

  const handleDragEnd = async (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const { offset, velocity } = info;
    const threshold = 80;
    const velocityThreshold = 300;

    const swipedRight = offset.x > threshold || (offset.x > 40 && velocity.x > velocityThreshold);
    const swipedLeft = offset.x < -threshold || (offset.x < -40 && velocity.x < -velocityThreshold);
    const swipedDown = offset.y > threshold || (offset.y > 40 && velocity.y > velocityThreshold);

    if (swipedDown && Math.abs(offset.y) > Math.abs(offset.x)) {
      await controls.start({ y: 400, opacity: 0, transition: { duration: 0.2 } });
      onTodo();
    } else if (swipedRight) {
      await controls.start({ x: 400, opacity: 0, transition: { duration: 0.2 } });
      onMarkAsRead();
    } else if (swipedLeft) {
      await controls.start({ x: -400, opacity: 0, transition: { duration: 0.2 } });
      onSkip();
    } else {
      controls.start({ x: 0, y: 0, transition: { type: 'spring', stiffness: 500, damping: 30 } });
    }
    setSwipeDirection(null);
  };

  const getInitials = (name: string) => {
    const parts = name.split(' ').filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  const getAvatarColor = (email: string) => {
    let hash = 0;
    for (let i = 0; i < email.length; i++) {
      hash = email.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = hash % 360;
    return `hsl(${hue}, 65%, 55%)`;
  };

  const toggleEmail = (emailId: string) => {
    setExpandedEmailId(prev => prev === emailId ? null : emailId);
  };

  const firstEmail = group.emails[0];

  return (
    <motion.div
      ref={cardRef}
      className={`${styles.card} ${styles[viewMode]}`}
      drag
      dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
      dragElastic={0.7}
      onDrag={handleDrag}
      onDragEnd={handleDragEnd}
      animate={controls}
      initial={{ scale: 0.95, opacity: 0 }}
      whileTap={{ cursor: 'grabbing' }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      style={{ touchAction: 'none' }}
    >
      {swipeDirection === 'left' && (
        <div className={`${styles.indicator} ${styles.skipIndicator}`}>SKIP</div>
      )}
      {swipeDirection === 'right' && (
        <div className={`${styles.indicator} ${styles.readIndicator}`}>READ</div>
      )}
      {swipeDirection === 'down' && (
        <div className={`${styles.indicator} ${styles.todoIndicator}`}>TODO</div>
      )}

      <div className={styles.senderHeader}>
        <div
          className={styles.avatar}
          style={{ backgroundColor: getAvatarColor(group.senderEmail) }}
        >
          {getInitials(group.senderName)}
        </div>
        <div className={styles.senderInfo}>
          <div className={styles.senderName}>{group.senderName}</div>
          <div className={styles.senderEmail}>{group.senderEmail}</div>
        </div>
        <div className={styles.headerActions}>
          {onUndo && (
            <button onClick={onUndo} className={styles.undoButton}>
              Undo
            </button>
          )}
          <a
            href={getGmailUrl(firstEmail.id)}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.actionLink}
          >
            Open
          </a>
          <a
            href={getReplyUrl(firstEmail.id)}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.actionLink}
          >
            Reply
          </a>
        </div>
      </div>

      {(viewMode === 'single' || expandedEmailId) && (
        <div className={styles.viewToggle}>
          <button
            className={`${styles.viewToggleBtn} ${!readerView ? styles.active : ''}`}
            onClick={() => setReaderView(false)}
          >
            Full
          </button>
          <button
            className={`${styles.viewToggleBtn} ${readerView ? styles.active : ''}`}
            onClick={() => setReaderView(true)}
          >
            Reader
          </button>
        </div>
      )}

      <div className={styles.cardContent}>
        {viewMode === 'table' ? (
          <TableView
            emails={group.emails}
            expandedEmailId={expandedEmailId}
            onToggle={toggleEmail}
            readerView={readerView}
            onEmailAction={onEmailAction}
          />
        ) : viewMode === 'single' ? (
          <SingleView email={group.emails[0]} readerView={readerView} />
        ) : (
          <CardListView
            emails={group.emails}
            expandedEmailId={expandedEmailId}
            onToggle={toggleEmail}
            readerView={readerView}
            onEmailAction={onEmailAction}
          />
        )}
      </div>

      <div className={styles.footer}>
        <button className={styles.footerBtn} onClick={onSkip}>
          <span className={styles.arrow}>‹</span> Skip
        </button>
        <button className={styles.footerBtnCenter} onClick={onTodo}>
          ↓ Todo
        </button>
        <button className={styles.footerBtn} onClick={onMarkAsRead}>
          Mark as Read <span className={styles.arrow}>›</span>
        </button>
      </div>
    </motion.div>
  );
}

interface SingleViewProps {
  email: ParsedEmail;
  readerView: boolean;
}

function SingleView({ email, readerView }: SingleViewProps) {
  return (
    <div className={styles.singleView}>
      <div className={styles.singleHeader}>
        <h2 className={styles.singleSubject}>{email.subject}</h2>
        <span className={styles.singleDate}>
          {format(email.date, 'MMM d, yyyy \'at\' h:mm a')}
        </span>
      </div>
      <EmailContent email={email} readerView={readerView} />
    </div>
  );
}

interface CardListViewProps {
  emails: ParsedEmail[];
  expandedEmailId: string | null;
  onToggle: (id: string) => void;
  readerView: boolean;
  onEmailAction: (emailId: string, action: 'read' | 'skip' | 'todo') => void;
}

function CardListView({ emails, expandedEmailId, onToggle, readerView, onEmailAction }: CardListViewProps) {
  return (
    <div className={styles.cardList}>
      {emails.map((email) => (
        <EmailCard
          key={email.id}
          email={email}
          isExpanded={expandedEmailId === email.id}
          onToggle={() => onToggle(email.id)}
          readerView={readerView}
          onAction={onEmailAction}
        />
      ))}
    </div>
  );
}

interface EmailCardProps {
  email: ParsedEmail;
  isExpanded: boolean;
  onToggle: () => void;
  readerView: boolean;
  onAction: (emailId: string, action: 'read' | 'skip' | 'todo') => void;
}

function EmailCard({ email, isExpanded, onToggle, readerView, onAction }: EmailCardProps) {
  return (
    <div className={styles.emailCard}>
      <div className={styles.emailCardHeader}>
        <button className={styles.emailCardToggle} onClick={onToggle}>
          <div className={styles.emailCardMeta}>
            <span className={styles.emailCardSubject}>{email.subject}</span>
            <span className={styles.emailCardDate}>
              {formatDistanceToNow(email.date, { addSuffix: true })}
            </span>
          </div>
          <span className={styles.expandIcon}>{isExpanded ? '−' : '+'}</span>
        </button>
        <div className={styles.emailActions}>
          <button
            className={styles.emailActionBtn}
            onClick={() => onAction(email.id, 'skip')}
            title="Skip"
          >
            ‹
          </button>
          <button
            className={styles.emailActionBtn}
            onClick={() => onAction(email.id, 'read')}
            title="Mark as Read"
          >
            ›
          </button>
        </div>
      </div>

      {isExpanded ? (
        <div className={styles.emailCardBody}>
          <EmailContent email={email} readerView={readerView} />
        </div>
      ) : (
        <div className={styles.emailCardSnippet}>{email.snippet}</div>
      )}
    </div>
  );
}

interface TableViewProps {
  emails: ParsedEmail[];
  expandedEmailId: string | null;
  onToggle: (id: string) => void;
  readerView: boolean;
  onEmailAction: (emailId: string, action: 'read' | 'skip' | 'todo') => void;
}

function TableView({ emails, expandedEmailId, onToggle, readerView, onEmailAction }: TableViewProps) {
  return (
    <div className={styles.tableView}>
      <div className={styles.tableHeader}>
        <span className={styles.tableColSubject}>Subject</span>
        <span className={styles.tableColDate}>Date</span>
        <span className={styles.tableColActions}></span>
      </div>
      <div className={styles.tableBody}>
        {emails.map((email) => (
          <div key={email.id} className={styles.tableRowWrapper}>
            <div className={styles.tableRow}>
              <button
                className={`${styles.tableRowContent} ${expandedEmailId === email.id ? styles.tableRowExpanded : ''}`}
                onClick={() => onToggle(email.id)}
              >
                <span className={styles.tableColSubject}>
                  <span className={styles.tableSubjectText}>{email.subject}</span>
                  <span className={styles.tableSnippet}>{email.snippet}</span>
                </span>
                <span className={styles.tableColDate}>
                  {format(email.date, 'MMM d')}
                </span>
              </button>
              <div className={styles.tableColActions}>
                <button
                  className={styles.tableActionBtn}
                  onClick={() => onEmailAction(email.id, 'skip')}
                  title="Skip"
                >
                  ‹
                </button>
                <button
                  className={styles.tableActionBtn}
                  onClick={() => onEmailAction(email.id, 'read')}
                  title="Mark as Read"
                >
                  ›
                </button>
              </div>
            </div>
            {expandedEmailId === email.id && (
              <div className={styles.tableExpandedContent}>
                <EmailContent email={email} readerView={readerView} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

import { useState, useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { motion, useAnimation, type PanInfo } from 'framer-motion';
import { formatDistanceToNow, format } from 'date-fns';
import type { SenderGroup, ParsedEmail } from '../types/gmail';
import { EmailContent } from './EmailContent';
import styles from './SenderCard.module.css';

export type DragOffset = { x: number; y: number };

interface SenderCardProps {
  group: SenderGroup;
  onSkip: (offset?: DragOffset) => void;
  onMarkAsRead: (offset?: DragOffset) => void;
  onTodo: (offset?: DragOffset) => void;
  onUndo?: () => void;
  onEmailAction: (emailId: string, action: 'read' | 'skip' | 'todo') => void;
  departDirection?: 'left' | 'right' | 'down';
  departOffset?: DragOffset;
  onDepartDone?: () => void;
}

export interface SenderCardHandle {
  animateSkip: () => Promise<void>;
  animateMarkAsRead: () => Promise<void>;
  animateTodo: () => Promise<void>;
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

function getGmailSearchUrl(senderEmail: string): string {
  return `https://mail.google.com/mail/u/0/#search/from%3A${encodeURIComponent(senderEmail)}+is%3Aunread`;
}

function decodeHtmlEntities(text: string): string {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}

export const SenderCard = forwardRef<SenderCardHandle, SenderCardProps>(
  function SenderCard({ group, onSkip, onMarkAsRead, onTodo, onUndo, onEmailAction, departDirection, departOffset, onDepartDone }, ref) {
  const [expandedEmailId, setExpandedEmailId] = useState<string | null>(
    group.emails.length === 1 ? group.emails[0].id : null
  );
  const [readerView, setReaderView] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | 'down' | null>(null);
  const controls = useAnimation();
  const cardRef = useRef<HTMLDivElement>(null);
  const viewMode = getViewMode(group.emails.length);

  useEffect(() => {
    if (departDirection) {
      const startX = departOffset?.x ?? 0;
      const startY = departOffset?.y ?? 0;
      const target = departDirection === 'left'
        ? { x: -window.innerWidth, y: startY }
        : departDirection === 'right'
        ? { x: window.innerWidth, y: startY }
        : { x: startX, y: window.innerHeight };
      controls.start({ ...target, transition: { duration: 0.4, ease: [0.4, 0, 1, 1] } })
        .then(() => onDepartDone?.());
    } else {
      controls.start({ scale: 1, opacity: 1, x: 0, y: 0, transition: { duration: 0.12 } });
    }
  }, [controls, departDirection, departOffset, onDepartDone]);

  useImperativeHandle(ref, () => ({
    animateSkip: async () => { onSkip(); },
    animateMarkAsRead: async () => { onMarkAsRead(); },
    animateTodo: async () => { onTodo(); },
  }));

  const handleDrag = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const { offset } = info;
    if (Math.abs(offset.y) > Math.abs(offset.x) && offset.y > 60) {
      setSwipeDirection('down');
    } else if (offset.x > 60) {
      setSwipeDirection('right');
    } else if (offset.x < -60) {
      setSwipeDirection('left');
    } else {
      setSwipeDirection(null);
    }
  };

  const handleDragEnd = async (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const { offset, velocity } = info;
    const threshold = 120;
    const velocityThreshold = 500;

    const swipedRight = offset.x > threshold || (offset.x > 80 && velocity.x > velocityThreshold);
    const swipedLeft = offset.x < -threshold || (offset.x < -80 && velocity.x < -velocityThreshold);
    const swipedDown = offset.y > threshold || (offset.y > 80 && velocity.y > velocityThreshold);

    // dragElastic scales the visual position relative to the raw offset
    const elastic = 0.7;
    const dragOffset = { x: offset.x * elastic, y: offset.y * elastic };
    if (swipedDown && Math.abs(offset.y) > Math.abs(offset.x)) {
      onTodo(dragOffset);
    } else if (swipedRight) {
      onMarkAsRead(dragOffset);
    } else if (swipedLeft) {
      onSkip(dragOffset);
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
      className={`${styles.card} ${styles[viewMode]} ${departDirection ? styles.departingCard : ''}`}
      drag={!departDirection}
      dragConstraints={!departDirection ? { left: 0, right: 0, top: 0, bottom: 0 } : undefined}
      dragElastic={0.7}
      onDrag={!departDirection ? handleDrag : undefined}
      onDragEnd={!departDirection ? handleDragEnd : undefined}
      animate={controls}
      initial={departDirection ? { x: departOffset?.x ?? 0, y: departOffset?.y ?? 0 } : { scale: 0.95, opacity: 0 }}
      whileDrag={!departDirection ? { cursor: 'grabbing' } : undefined}
      style={{ touchAction: 'none' }}
    >
      {swipeDirection === 'left' && (
        <div className={`${styles.indicator} ${styles.skipIndicator}`}>SKIP</div>
      )}
      {swipeDirection === 'right' && (
        <div className={`${styles.indicator} ${styles.readIndicator}`}>MARK AS READ</div>
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
            href={group.emails.length === 1 ? getGmailUrl(firstEmail.id) : getGmailSearchUrl(group.senderEmail)}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.actionLink}
          >
            Open
          </a>
          {group.emails.length === 1 && (
          <a
            href={getReplyUrl(firstEmail.id)}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.actionLink}
          >
            Reply
          </a>
          )}
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
});

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
  const [swipeDir, setSwipeDir] = useState<'left' | 'right' | 'down' | null>(null);
  const controls = useAnimation();

  const handleEmailDrag = (e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    e.stopPropagation();
    const { offset } = info;
    if (Math.abs(offset.y) > Math.abs(offset.x) && offset.y > 30) {
      setSwipeDir('down');
    } else if (offset.x > 40) {
      setSwipeDir('right');
    } else if (offset.x < -40) {
      setSwipeDir('left');
    } else {
      setSwipeDir(null);
    }
  };

  const handleEmailDragEnd = async (e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    e.stopPropagation();
    const { offset, velocity } = info;
    const threshold = 80;
    const velocityThreshold = 400;

    const swipedRight = offset.x > threshold || (offset.x > 50 && velocity.x > velocityThreshold);
    const swipedLeft = offset.x < -threshold || (offset.x < -50 && velocity.x < -velocityThreshold);
    const swipedDown = offset.y > threshold || (offset.y > 50 && velocity.y > velocityThreshold);

    if (swipedDown && Math.abs(offset.y) > Math.abs(offset.x)) {
      await controls.start({ y: 200, opacity: 0, transition: { duration: 0.15 } });
      onAction(email.id, 'todo');
    } else if (swipedRight) {
      await controls.start({ x: 400, opacity: 0, transition: { duration: 0.15 } });
      onAction(email.id, 'read');
    } else if (swipedLeft) {
      await controls.start({ x: -400, opacity: 0, transition: { duration: 0.15 } });
      onAction(email.id, 'skip');
    } else {
      controls.start({ x: 0, y: 0, transition: { type: 'spring', stiffness: 500, damping: 30 } });
    }
    setSwipeDir(null);
  };

  return (
    <div className={styles.emailCardWrapper}>
      {swipeDir === 'left' && (
        <div className={`${styles.emailIndicator} ${styles.emailSkipIndicator}`}>SKIP</div>
      )}
      {swipeDir === 'right' && (
        <div className={`${styles.emailIndicator} ${styles.emailReadIndicator}`}>MARK AS READ</div>
      )}
      {swipeDir === 'down' && (
        <div className={`${styles.emailIndicator} ${styles.emailTodoIndicator}`}>TODO</div>
      )}
      <motion.div
        className={styles.emailCard}
        drag
        dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
        dragElastic={0.5}
        onDrag={handleEmailDrag}
        onDragEnd={handleEmailDragEnd}
        animate={controls}
        style={{ touchAction: 'none' }}
      >
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
            <a
              href={getGmailUrl(email.id)}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.emailActionBtn}
              title="Open in Gmail"
            >
              ↗
            </a>
            <a
              href={getReplyUrl(email.id)}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.emailActionBtn}
              title="Reply"
            >
              ↩
            </a>
          </div>
        </div>

        {isExpanded ? (
          <div className={styles.emailCardBody}>
            <EmailContent email={email} readerView={readerView} />
          </div>
        ) : (
          <div className={styles.emailCardSnippet}>{decodeHtmlEntities(email.snippet)}</div>
        )}
      </motion.div>
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
          <TableRow
            key={email.id}
            email={email}
            isExpanded={expandedEmailId === email.id}
            onToggle={() => onToggle(email.id)}
            readerView={readerView}
            onAction={onEmailAction}
          />
        ))}
      </div>
    </div>
  );
}

interface TableRowProps {
  email: ParsedEmail;
  isExpanded: boolean;
  onToggle: () => void;
  readerView: boolean;
  onAction: (emailId: string, action: 'read' | 'skip' | 'todo') => void;
}

function TableRow({ email, isExpanded, onToggle, readerView, onAction }: TableRowProps) {
  const [swipeDir, setSwipeDir] = useState<'left' | 'right' | 'down' | null>(null);
  const controls = useAnimation();

  const handleRowDrag = (e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    e.stopPropagation();
    const { offset } = info;
    if (Math.abs(offset.y) > Math.abs(offset.x) && offset.y > 30) {
      setSwipeDir('down');
    } else if (offset.x > 40) {
      setSwipeDir('right');
    } else if (offset.x < -40) {
      setSwipeDir('left');
    } else {
      setSwipeDir(null);
    }
  };

  const handleRowDragEnd = async (e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    e.stopPropagation();
    const { offset, velocity } = info;
    const threshold = 80;
    const velocityThreshold = 400;

    const swipedRight = offset.x > threshold || (offset.x > 50 && velocity.x > velocityThreshold);
    const swipedLeft = offset.x < -threshold || (offset.x < -50 && velocity.x < -velocityThreshold);
    const swipedDown = offset.y > threshold || (offset.y > 50 && velocity.y > velocityThreshold);

    if (swipedDown && Math.abs(offset.y) > Math.abs(offset.x)) {
      await controls.start({ y: 200, opacity: 0, transition: { duration: 0.15 } });
      onAction(email.id, 'todo');
    } else if (swipedRight) {
      await controls.start({ x: 400, opacity: 0, transition: { duration: 0.15 } });
      onAction(email.id, 'read');
    } else if (swipedLeft) {
      await controls.start({ x: -400, opacity: 0, transition: { duration: 0.15 } });
      onAction(email.id, 'skip');
    } else {
      controls.start({ x: 0, y: 0, transition: { type: 'spring', stiffness: 500, damping: 30 } });
    }
    setSwipeDir(null);
  };

  return (
    <div className={styles.tableRowOuter}>
      {swipeDir === 'left' && (
        <div className={`${styles.emailIndicator} ${styles.emailSkipIndicator}`}>SKIP</div>
      )}
      {swipeDir === 'right' && (
        <div className={`${styles.emailIndicator} ${styles.emailReadIndicator}`}>MARK AS READ</div>
      )}
      {swipeDir === 'down' && (
        <div className={`${styles.emailIndicator} ${styles.emailTodoIndicator}`}>TODO</div>
      )}
      <motion.div
        className={styles.tableRowWrapper}
        drag
        dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
        dragElastic={0.5}
        onDrag={handleRowDrag}
        onDragEnd={handleRowDragEnd}
        animate={controls}
        style={{ touchAction: 'none' }}
      >
        <div className={styles.tableRow}>
          <button
            className={`${styles.tableRowContent} ${isExpanded ? styles.tableRowExpanded : ''}`}
            onClick={onToggle}
          >
            <span className={styles.tableColSubject}>
              <span className={styles.tableSubjectText}>{email.subject}</span>
              <span className={styles.tableSnippet}>{decodeHtmlEntities(email.snippet)}</span>
            </span>
            <span className={styles.tableColDate}>
              {format(email.date, 'MMM d')}
            </span>
          </button>
          <div className={styles.tableColActions}>
            <a
              href={getGmailUrl(email.id)}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.tableActionBtn}
              title="Open in Gmail"
            >
              ↗
            </a>
            <a
              href={getReplyUrl(email.id)}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.tableActionBtn}
              title="Reply"
            >
              ↩
            </a>
          </div>
        </div>
        {isExpanded && (
          <div className={styles.tableExpandedContent}>
            <EmailContent email={email} readerView={readerView} />
          </div>
        )}
      </motion.div>
    </div>
  );
}

import { useState, useEffect, useCallback, useRef } from 'react';
import { SenderCard, type SenderCardHandle, type DragOffset } from './SenderCard';
import { TodoSidebar } from './TodoSidebar';
import { fetchAllUnreadEmails, groupEmailsBySender, markAsRead, markMultipleAsRead, markMultipleAsUnread, markAsUnread, type LoadingProgress } from '../services/gmail';
import type { SenderGroup, ParsedEmail } from '../types/gmail';
import styles from './CatchUpView.module.css';

interface CatchUpViewProps {
  accessToken: string;
  userEmail: string | null;
  onSignOut: () => void;
}

type ActionType = 'read' | 'skip' | 'todo';

type GroupAction = {
  scope: 'group';
  type: ActionType;
  group: SenderGroup;
  groupIndex: number;
};

type EmailAction = {
  scope: 'email';
  type: ActionType;
  email: ParsedEmail;
  groupIndex: number;
  originalGroup: SenderGroup;
};

type Action = GroupAction | EmailAction;

export function CatchUpView({ accessToken, userEmail, onSignOut }: CatchUpViewProps) {
  const [senderGroups, setSenderGroups] = useState<SenderGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState<LoadingProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [todoGroups, setTodoGroups] = useState<SenderGroup[]>([]);
  const [actionHistory, setActionHistory] = useState<Action[]>([]);
  const [showComplete, setShowComplete] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [departingGroup, setDepartingGroup] = useState<SenderGroup | null>(null);
  const [departingDirection, setDepartingDirection] = useState<'left' | 'right' | 'down'>('left');
  const [departingOffset, setDepartingOffset] = useState<DragOffset>({ x: 0, y: 0 });
  const cardRef = useRef<SenderCardHandle>(null);
  const departingRef = useRef<SenderCardHandle>(null);

  const loadEmails = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setLoadingProgress(null);

    try {
      const emails = await fetchAllUnreadEmails(accessToken, (progress) => {
        setLoadingProgress(prev => {
          // Never let the loaded count decrease
          if (prev && prev.phase === progress.phase && progress.loaded < prev.loaded) {
            return prev;
          }
          return progress;
        });
      });
      const groups = groupEmailsBySender(emails);
      setSenderGroups(groups);
      setCurrentIndex(0);
      setTodoGroups([]);
      setActionHistory([]);
      setShowComplete(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load emails');
    } finally {
      setIsLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    loadEmails();
  }, [loadEmails]);

  const currentGroup = senderGroups[currentIndex];

  // Keyboard shortcuts
  useEffect(() => {
    if (isLoading || showComplete || !currentGroup) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // Ctrl+Z / Cmd+Z for undo
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleUndo();
        return;
      }

      // Don't capture arrow keys with any modifier
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          cardRef.current?.animateSkip();
          break;
        case 'ArrowRight':
          e.preventDefault();
          cardRef.current?.animateMarkAsRead();
          break;
        case 'ArrowDown':
          e.preventDefault();
          cardRef.current?.animateTodo();
          break;
        case 'ArrowUp':
          e.preventDefault();
          handleUndo();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });
  const remainingGroups = senderGroups.length - currentIndex;
  const remainingEmails = senderGroups.slice(currentIndex).reduce((sum, g) => sum + g.emails.length, 0);

  const advanceToNext = () => {
    if (currentIndex < senderGroups.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      setShowComplete(true);
    }
  };

  const departCurrentCard = (direction: 'left' | 'right' | 'down', offset?: DragOffset) => {
    if (!currentGroup) return;
    setDepartingGroup(currentGroup);
    setDepartingDirection(direction);
    setDepartingOffset(offset ?? { x: 0, y: 0 });
  };

  const handleDepartingDone = () => {
    setDepartingGroup(null);
  };

  const handleMarkAsRead = (offset?: DragOffset) => {
    if (!currentGroup) return;

    setActionHistory(prev => [...prev, { scope: 'group', type: 'read', group: currentGroup, groupIndex: currentIndex }]);
    departCurrentCard('right', offset);
    advanceToNext();

    const messageIds = currentGroup.emails.map(e => e.id);
    markMultipleAsRead(accessToken, messageIds).catch(err => {
      console.error('Failed to mark as read:', err);
    });
  };

  const handleSkip = (offset?: DragOffset) => {
    if (!currentGroup) return;

    setActionHistory(prev => [...prev, { scope: 'group', type: 'skip', group: currentGroup, groupIndex: currentIndex }]);
    departCurrentCard('left', offset);
    advanceToNext();
  };

  const handleTodo = (offset?: DragOffset) => {
    if (!currentGroup) return;

    setActionHistory(prev => [...prev, { scope: 'group', type: 'todo', group: currentGroup, groupIndex: currentIndex }]);
    departCurrentCard('down', offset);
    // Merge with existing todo group from same sender
    setTodoGroups(prev => {
      const existingIdx = prev.findIndex(g => g.senderEmail.toLowerCase() === currentGroup.senderEmail.toLowerCase());
      if (existingIdx !== -1) {
        const updated = [...prev];
        updated[existingIdx] = {
          ...updated[existingIdx],
          emails: [...updated[existingIdx].emails, ...currentGroup.emails],
        };
        return updated;
      }
      return [...prev, currentGroup];
    });
    advanceToNext();
  };

  const handleUndo = async () => {
    if (actionHistory.length === 0) return;

    const lastAction = actionHistory[actionHistory.length - 1];
    setActionHistory(prev => prev.slice(0, -1));

    if (lastAction.scope === 'group') {
      if (lastAction.type === 'todo') {
        // Remove the group's emails from todo
        setTodoGroups(prev => {
          return prev.map(g => {
            if (g.senderEmail.toLowerCase() === lastAction.group.senderEmail.toLowerCase()) {
              const emailIds = new Set(lastAction.group.emails.map(e => e.id));
              const remaining = g.emails.filter(e => !emailIds.has(e.id));
              if (remaining.length === 0) return null;
              return { ...g, emails: remaining };
            }
            return g;
          }).filter((g): g is SenderGroup => g !== null);
        });
      }

      if (lastAction.type === 'read') {
        try {
          const messageIds = lastAction.group.emails.map(e => e.id);
          await markMultipleAsUnread(accessToken, messageIds);
        } catch (err) {
          console.error('Failed to mark as unread:', err);
        }
      }

      setCurrentIndex(prev => prev - 1);
      setShowComplete(false);
    } else {
      // Email-level action
      const { email, groupIndex, originalGroup } = lastAction;

      if (lastAction.type === 'todo') {
        // Remove email from todo groups
        setTodoGroups(prev => {
          return prev.map(g => {
            if (g.senderEmail.toLowerCase() === email.fromEmail.toLowerCase()) {
              const remaining = g.emails.filter(e => e.id !== email.id);
              if (remaining.length === 0) return null;
              return { ...g, emails: remaining };
            }
            return g;
          }).filter((g): g is SenderGroup => g !== null);
        });
      }

      if (lastAction.type === 'read') {
        try {
          await markAsUnread(accessToken, email.id);
        } catch (err) {
          console.error('Failed to mark as unread:', err);
        }
      }

      // Re-add the email to its original group
      setSenderGroups(prev => {
        const updated = [...prev];
        const group = updated[groupIndex];
        if (group && group.senderEmail.toLowerCase() === originalGroup.senderEmail.toLowerCase()) {
          // Add email back, sorted by date
          const emails = [...group.emails, email].sort((a, b) => b.date.getTime() - a.date.getTime());
          updated[groupIndex] = { ...group, emails };
        }
        return updated;
      });
    }
  };

  const handleEmailAction = async (emailId: string, action: 'read' | 'skip' | 'todo') => {
    if (!currentGroup) return;

    const email = currentGroup.emails.find(e => e.id === emailId);
    if (!email) return;

    // Track action in history for undo
    setActionHistory(prev => [...prev, {
      scope: 'email',
      type: action,
      email,
      groupIndex: currentIndex,
      originalGroup: currentGroup,
    }]);

    if (action === 'read') {
      try {
        await markAsRead(accessToken, emailId);
      } catch (err) {
        console.error('Failed to mark as read:', err);
      }
    }

    if (action === 'todo') {
      // Merge with existing todo group from same sender
      setTodoGroups(prev => {
        const existingIdx = prev.findIndex(g => g.senderEmail.toLowerCase() === email.fromEmail.toLowerCase());
        if (existingIdx !== -1) {
          const updated = [...prev];
          updated[existingIdx] = {
            ...updated[existingIdx],
            emails: [...updated[existingIdx].emails, email].sort((a, b) => b.date.getTime() - a.date.getTime()),
          };
          return updated;
        }
        return [...prev, {
          senderEmail: email.fromEmail,
          senderName: email.from,
          emails: [email],
        }];
      });
    }

    // Remove the email from the current group
    const updatedEmails = currentGroup.emails.filter(e => e.id !== emailId);

    if (updatedEmails.length === 0) {
      // No more emails in this group, move to next
      advanceToNext();
    } else {
      // Update the group with remaining emails
      const updatedGroups = [...senderGroups];
      updatedGroups[currentIndex] = { ...currentGroup, emails: updatedEmails };
      setSenderGroups(updatedGroups);
    }
  };

  const handleTodoClick = (group: SenderGroup) => {
    const idx = senderGroups.findIndex(g => g.senderEmail.toLowerCase() === group.senderEmail.toLowerCase());
    if (idx !== -1) {
      setTodoGroups(prev => prev.filter(g => g.senderEmail.toLowerCase() !== group.senderEmail.toLowerCase()));
      // Filter out actions related to this sender's emails
      setActionHistory(prev => prev.filter(a => {
        if (a.scope === 'group') {
          return a.group.senderEmail.toLowerCase() !== group.senderEmail.toLowerCase();
        } else {
          return a.email.fromEmail.toLowerCase() !== group.senderEmail.toLowerCase();
        }
      }));
      setCurrentIndex(idx);
      setShowComplete(false);
      setSidebarOpen(false);
    }
  };

  const handleRemoveTodo = (group: SenderGroup) => {
    setTodoGroups(prev => prev.filter(g => g.senderEmail.toLowerCase() !== group.senderEmail.toLowerCase()));
  };

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
          {loadingProgress ? (
            loadingProgress.phase === 'listing' ? (
              <p>Found {loadingProgress.total} unread emails...</p>
            ) : (
              <p>Loading {loadingProgress.loaded} of {loadingProgress.total} emails...</p>
            )
          ) : (
            <p>Connecting to Gmail...</p>
          )}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>
          <h2>Something went wrong</h2>
          <p>{error}</p>
          <button onClick={loadEmails} className={styles.retryButton}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (senderGroups.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>Inbox Zero</div>
          <p>You have no unread emails!</p>
          <button onClick={loadEmails} className={styles.refreshButton}>
            Refresh
          </button>
        </div>
      </div>
    );
  }

  if (showComplete) {
    const markedRead = actionHistory.filter(a => a.type === 'read').reduce((sum, a) => {
      if (a.scope === 'group') {
        return sum + a.group.emails.length;
      } else {
        return sum + 1;
      }
    }, 0);

    return (
      <div className={styles.container}>
        <div className={styles.complete}>
          <div className={styles.completeIcon}>Done</div>
          <h2>All caught up!</h2>
          <p>
            {markedRead > 0 && <>Marked {markedRead} email{markedRead !== 1 ? 's' : ''} as read. </>}
            {todoGroups.length > 0 && <>{todoGroups.length} item{todoGroups.length !== 1 ? 's' : ''} in your todo list.</>}
          </p>

          {todoGroups.length > 0 && (
            <div className={styles.todoList}>
              <h3>Your Todos</h3>
              {todoGroups.map(group => (
                <button
                  key={group.senderEmail}
                  className={styles.todoItem}
                  onClick={() => handleTodoClick(group)}
                >
                  <span className={styles.todoSender}>{group.senderName}</span>
                  <span className={styles.todoCount}>{group.emails.length}</span>
                </button>
              ))}
            </div>
          )}

          <div className={styles.completeActions}>
            <button onClick={loadEmails} className={styles.refreshButton}>
              Check for New Emails
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.userEmail}>{userEmail}</span>
          <button onClick={onSignOut} className={styles.signOutButton}>
            Sign Out
          </button>
        </div>
        <div className={styles.headerCenter}>
          <span className={styles.remaining}>{remainingEmails} emails</span>
          <span className={styles.senders}>{remainingGroups} senders</span>
        </div>
        <div className={styles.headerRight}>
          {todoGroups.length > 0 && (
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className={styles.todoToggle}
            >
              Todo ({todoGroups.length})
            </button>
          )}
        </div>
      </header>

      <div className={styles.mainContent}>
        <div className={styles.cardStack}>
          {currentGroup && (
            <SenderCard
              ref={cardRef}
              key={currentGroup.senderEmail}
              group={currentGroup}
              onSkip={handleSkip}
              onMarkAsRead={handleMarkAsRead}
              onTodo={handleTodo}
              onUndo={actionHistory.length > 0 ? handleUndo : undefined}
              onEmailAction={handleEmailAction}
            />
          )}
          {departingGroup && (
            <SenderCard
              ref={departingRef}
              key={`departing-${departingGroup.senderEmail}`}
              group={departingGroup}
              onSkip={() => {}}
              onMarkAsRead={() => {}}
              onTodo={() => {}}
              onEmailAction={() => {}}
              departDirection={departingDirection}
              departOffset={departingOffset}
              onDepartDone={handleDepartingDone}
            />
          )}
        </div>

        <TodoSidebar
          todos={todoGroups}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onTodoClick={handleTodoClick}
          onRemoveTodo={handleRemoveTodo}
        />
      </div>
    </div>
  );
}

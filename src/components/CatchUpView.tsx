import { useState, useEffect, useCallback, useRef } from 'react';
import { SenderCard, type SenderCardHandle, type DragOffset } from './SenderCard';
import { TodoSidebar } from './TodoSidebar';
import { fetchAllUnreadEmails, groupEmailsBySender, markAsRead, markMultipleAsRead, markMultipleAsUnread, markAsUnread, AuthExpiredError, type LoadingProgress } from '../services/gmail';
import { loadPersistedState, savePersistedState, clearPersistedState } from '../hooks/usePersistedState';
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

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

export function CatchUpView({ accessToken, userEmail, onSignOut }: CatchUpViewProps) {
  const [senderGroups, setSenderGroups] = useState<SenderGroup[]>([]);
  const [isLoading, setIsLoading] = useState(false);
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
  const [reviewingTodos, setReviewingTodos] = useState(false);
  const [lastFetchTime, setLastFetchTime] = useState(0);
  const [showRefreshDialog, setShowRefreshDialog] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const cardRef = useRef<SenderCardHandle>(null);
  const departingRef = useRef<SenderCardHandle>(null);

  // --- Persistence ---

  // Load persisted state on mount
  useEffect(() => {
    const saved = loadPersistedState();
    if (saved && saved.senderGroups.length > 0) {
      setSenderGroups(saved.senderGroups);
      setCurrentIndex(saved.currentIndex);
      setTodoGroups(saved.todoGroups);
      setReviewingTodos(saved.reviewingTodos);
      setLastFetchTime(saved.lastFetchTime);

      // Check if main queue was exhausted
      if (!saved.reviewingTodos && saved.currentIndex >= saved.senderGroups.length) {
        if (saved.todoGroups.length > 0) {
          setReviewingTodos(true);
        } else {
          setShowComplete(true);
        }
      } else if (saved.reviewingTodos && saved.todoGroups.length === 0) {
        setShowComplete(true);
      }

      // Suggest refresh if stale
      if (Date.now() - saved.lastFetchTime > THREE_HOURS_MS) {
        setShowRefreshDialog(true);
      }
      setInitialized(true);
    } else {
      // No saved state, fetch fresh
      setInitialized(true);
      fetchEmails();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Save state on changes (after initialization)
  useEffect(() => {
    if (!initialized || isLoading) return;
    savePersistedState({
      senderGroups,
      currentIndex,
      todoGroups,
      reviewingTodos,
      lastFetchTime,
    });
  }, [senderGroups, currentIndex, todoGroups, reviewingTodos, lastFetchTime, initialized, isLoading]);

  // --- Data fetching ---

  const fetchEmails = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setLoadingProgress(null);

    try {
      const emails = await fetchAllUnreadEmails(accessToken, (progress) => {
        setLoadingProgress(prev => {
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
      setReviewingTodos(false);
      setShowComplete(false);
      setLastFetchTime(Date.now());
    } catch (err) {
      if (err instanceof AuthExpiredError) {
        setError('__auth_expired__');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load emails');
      }
    } finally {
      setIsLoading(false);
    }
  }, [accessToken]);

  const handleRefresh = () => {
    clearPersistedState();
    fetchEmails();
  };

  // --- Current group ---

  const currentGroup = reviewingTodos ? todoGroups[0] : senderGroups[currentIndex];

  // --- Keyboard shortcuts ---

  useEffect(() => {
    if (isLoading || showComplete || !currentGroup) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleUndo();
        return;
      }

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

  // --- Counts ---

  const remainingGroups = reviewingTodos
    ? todoGroups.length
    : senderGroups.length - currentIndex;
  const remainingEmails = reviewingTodos
    ? todoGroups.reduce((sum, g) => sum + g.emails.length, 0)
    : senderGroups.slice(currentIndex).reduce((sum, g) => sum + g.emails.length, 0);

  // --- Navigation ---

  const advanceToNext = () => {
    if (reviewingTodos) {
      setTodoGroups(prev => {
        const next = prev.slice(1);
        if (next.length === 0) setShowComplete(true);
        return next;
      });
      return;
    }
    if (currentIndex < senderGroups.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else if (todoGroups.length > 0) {
      setReviewingTodos(true);
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

  // --- Actions ---

  const handleMarkAsRead = (offset?: DragOffset) => {
    if (!currentGroup) return;

    setActionHistory(prev => [...prev, { scope: 'group', type: 'read', group: currentGroup, groupIndex: reviewingTodos ? -1 : currentIndex }]);
    departCurrentCard('right', offset);
    advanceToNext();

    const messageIds = currentGroup.emails.map(e => e.id);
    markMultipleAsRead(accessToken, messageIds).catch(err => {
      if (err instanceof AuthExpiredError) { setError('__auth_expired__'); return; }
      console.error('Failed to mark as read:', err);
    });
  };

  const handleSkip = (offset?: DragOffset) => {
    if (!currentGroup) return;

    setActionHistory(prev => [...prev, { scope: 'group', type: 'skip', group: currentGroup, groupIndex: reviewingTodos ? -1 : currentIndex }]);
    departCurrentCard('left', offset);
    advanceToNext();
  };

  const handleTodo = (offset?: DragOffset) => {
    if (!currentGroup) return;

    if (reviewingTodos) {
      // Move to end of todo queue
      departCurrentCard('down', offset);
      setTodoGroups(prev => {
        if (prev.length <= 1) return prev;
        return [...prev.slice(1), prev[0]];
      });
      return;
    }

    setActionHistory(prev => [...prev, { scope: 'group', type: 'todo', group: currentGroup, groupIndex: currentIndex }]);
    departCurrentCard('down', offset);
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
      // Undo from todo review mode
      if (lastAction.groupIndex === -1) {
        if (lastAction.type === 'read') {
          try {
            const messageIds = lastAction.group.emails.map(e => e.id);
            await markMultipleAsUnread(accessToken, messageIds);
          } catch (err) {
            if (err instanceof AuthExpiredError) { setError('__auth_expired__'); return; }
            console.error('Failed to mark as unread:', err);
          }
        }
        // Re-add to front of todo queue
        setTodoGroups(prev => [lastAction.group, ...prev]);
        setShowComplete(false);
        return;
      }

      if (lastAction.type === 'todo') {
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
          if (err instanceof AuthExpiredError) { setError('__auth_expired__'); return; }
          console.error('Failed to mark as unread:', err);
        }
      }

      // If we were reviewing todos, go back to inbox mode
      if (reviewingTodos) {
        setReviewingTodos(false);
      }
      setCurrentIndex(prev => prev - 1);
      setShowComplete(false);
    } else {
      // Email-level action
      const { email, groupIndex, originalGroup } = lastAction;

      if (lastAction.type === 'todo') {
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
          if (err instanceof AuthExpiredError) { setError('__auth_expired__'); return; }
          console.error('Failed to mark as unread:', err);
        }
      }

      setSenderGroups(prev => {
        const updated = [...prev];
        const group = updated[groupIndex];
        if (group && group.senderEmail.toLowerCase() === originalGroup.senderEmail.toLowerCase()) {
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

    setActionHistory(prev => [...prev, {
      scope: 'email',
      type: action,
      email,
      groupIndex: reviewingTodos ? -1 : currentIndex,
      originalGroup: currentGroup,
    }]);

    if (action === 'read') {
      try {
        await markAsRead(accessToken, emailId);
      } catch (err) {
        if (err instanceof AuthExpiredError) { setError('__auth_expired__'); return; }
        console.error('Failed to mark as read:', err);
      }
    }

    if (action === 'todo' && !reviewingTodos) {
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

    if (reviewingTodos) {
      // Remove email from the current todo group
      const updatedEmails = currentGroup.emails.filter(e => e.id !== emailId);
      if (updatedEmails.length === 0) {
        advanceToNext();
      } else {
        setTodoGroups(prev => {
          const updated = [...prev];
          updated[0] = { ...updated[0], emails: updatedEmails };
          return updated;
        });
      }
    } else {
      const updatedEmails = currentGroup.emails.filter(e => e.id !== emailId);
      if (updatedEmails.length === 0) {
        advanceToNext();
      } else {
        const updatedGroups = [...senderGroups];
        updatedGroups[currentIndex] = { ...currentGroup, emails: updatedEmails };
        setSenderGroups(updatedGroups);
      }
    }
  };

  const handleTodoClick = (group: SenderGroup) => {
    // Insert the todo group at current position
    setTodoGroups(prev => prev.filter(g => g.senderEmail.toLowerCase() !== group.senderEmail.toLowerCase()));
    setSenderGroups(prev => {
      const filtered = prev.filter(g => g.senderEmail.toLowerCase() !== group.senderEmail.toLowerCase());
      const insertAt = Math.min(currentIndex, filtered.length);
      return [...filtered.slice(0, insertAt), group, ...filtered.slice(insertAt)];
    });
    setShowComplete(false);
    setReviewingTodos(false);
    setSidebarOpen(false);
  };

  const handleRemoveTodo = (group: SenderGroup) => {
    setTodoGroups(prev => prev.filter(g => g.senderEmail.toLowerCase() !== group.senderEmail.toLowerCase()));
  };

  // --- Render ---

  if (!initialized || isLoading) {
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
    const isAuthExpired = error === '__auth_expired__';
    return (
      <div className={styles.container}>
        <div className={styles.error}>
          <h2>{isAuthExpired ? 'Session expired' : 'Something went wrong'}</h2>
          <p>{isAuthExpired ? 'Your Google session has expired. Please sign in again.' : error}</p>
          {isAuthExpired ? (
            <button onClick={onSignOut} className={styles.retryButton}>
              Sign In Again
            </button>
          ) : (
            <button onClick={fetchEmails} className={styles.retryButton}>
              Try Again
            </button>
          )}
        </div>
      </div>
    );
  }

  if (showRefreshDialog) {
    const hoursAgo = Math.round((Date.now() - lastFetchTime) / (60 * 60 * 1000));
    return (
      <div className={styles.container}>
        <div className={styles.refreshDialog}>
          <h2>Welcome back</h2>
          <p>Your emails were last fetched {hoursAgo} hour{hoursAgo !== 1 ? 's' : ''} ago.</p>
          <p>Would you like to fetch fresh emails? This will discard your current progress.</p>
          <div className={styles.dialogButtons}>
            <button onClick={() => { setShowRefreshDialog(false); handleRefresh(); }} className={styles.refreshButton}>
              Fetch Fresh Emails
            </button>
            <button onClick={() => setShowRefreshDialog(false)} className={styles.secondaryButton}>
              Continue Where I Left Off
            </button>
          </div>
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
          <button onClick={handleRefresh} className={styles.refreshButton}>
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
            {markedRead > 0 && <>Marked {markedRead} email{markedRead !== 1 ? 's' : ''} as read.</>}
          </p>

          <div className={styles.completeActions}>
            <button onClick={handleRefresh} className={styles.refreshButton}>
              Fetch Fresh Emails
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
          {reviewingTodos && <span className={styles.todoLabel}>Todos</span>}
          <span className={styles.remaining}>{remainingEmails} emails</span>
          <span className={styles.senders}>{remainingGroups} {reviewingTodos ? 'todos' : 'senders'}</span>
        </div>
        <div className={styles.headerRight}>
          {!reviewingTodos && todoGroups.length > 0 && (
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
              key={currentGroup.senderEmail + (reviewingTodos ? '-todo' : '')}
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

        {!reviewingTodos && (
          <TodoSidebar
            todos={todoGroups}
            isOpen={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            onTodoClick={handleTodoClick}
            onRemoveTodo={handleRemoveTodo}
          />
        )}
      </div>
    </div>
  );
}

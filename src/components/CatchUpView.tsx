import { useState, useEffect, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import { SenderCard } from './SenderCard';
import { TodoSidebar } from './TodoSidebar';
import { fetchAllUnreadEmails, groupEmailsBySender, markAsRead, markMultipleAsRead, type LoadingProgress } from '../services/gmail';
import type { SenderGroup } from '../types/gmail';
import styles from './CatchUpView.module.css';

interface CatchUpViewProps {
  accessToken: string;
  userEmail: string | null;
  onSignOut: () => void;
}

type ActionType = 'read' | 'skip' | 'todo';

type Action = {
  type: ActionType;
  group: SenderGroup;
};

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

  const loadEmails = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setLoadingProgress(null);

    try {
      const emails = await fetchAllUnreadEmails(accessToken, (progress) => {
        setLoadingProgress(progress);
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

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          handleSkip();
          break;
        case 'ArrowRight':
          e.preventDefault();
          handleMarkAsRead();
          break;
        case 'ArrowDown':
          e.preventDefault();
          handleTodo();
          break;
        case 'ArrowUp':
        case 'z':
          if (e.key === 'z' && !e.ctrlKey && !e.metaKey) break;
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

  const handleMarkAsRead = async () => {
    if (!currentGroup) return;

    setActionHistory(prev => [...prev, { type: 'read', group: currentGroup }]);

    try {
      const messageIds = currentGroup.emails.map(e => e.id);
      await markMultipleAsRead(accessToken, messageIds);
    } catch (err) {
      console.error('Failed to mark as read:', err);
    }

    advanceToNext();
  };

  const handleSkip = () => {
    if (!currentGroup) return;

    setActionHistory(prev => [...prev, { type: 'skip', group: currentGroup }]);
    advanceToNext();
  };

  const handleTodo = () => {
    if (!currentGroup) return;

    setActionHistory(prev => [...prev, { type: 'todo', group: currentGroup }]);
    setTodoGroups(prev => [...prev, currentGroup]);
    advanceToNext();
  };

  const handleUndo = () => {
    if (actionHistory.length === 0) return;

    const lastAction = actionHistory[actionHistory.length - 1];
    setActionHistory(prev => prev.slice(0, -1));

    if (lastAction.type === 'todo') {
      setTodoGroups(prev => prev.filter(g => g.senderEmail !== lastAction.group.senderEmail));
    }

    setCurrentIndex(prev => prev - 1);
    setShowComplete(false);
  };

  const handleEmailAction = async (emailId: string, action: 'read' | 'skip' | 'todo') => {
    if (!currentGroup) return;

    if (action === 'read') {
      try {
        await markAsRead(accessToken, emailId);
      } catch (err) {
        console.error('Failed to mark as read:', err);
      }
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
    const idx = senderGroups.findIndex(g => g.senderEmail === group.senderEmail);
    if (idx !== -1) {
      setTodoGroups(prev => prev.filter(g => g.senderEmail !== group.senderEmail));
      setActionHistory(prev => prev.filter(a => a.group.senderEmail !== group.senderEmail));
      setCurrentIndex(idx);
      setShowComplete(false);
      setSidebarOpen(false);
    }
  };

  const handleRemoveTodo = (group: SenderGroup) => {
    setTodoGroups(prev => prev.filter(g => g.senderEmail !== group.senderEmail));
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
    const markedRead = actionHistory.filter(a => a.type === 'read').reduce((sum, a) => sum + a.group.emails.length, 0);

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
          <AnimatePresence mode="wait">
            {currentGroup && (
              <SenderCard
                key={currentGroup.senderEmail}
                group={currentGroup}
                onSkip={handleSkip}
                onMarkAsRead={handleMarkAsRead}
                onTodo={handleTodo}
                onUndo={actionHistory.length > 0 ? handleUndo : undefined}
                onEmailAction={handleEmailAction}
              />
            )}
          </AnimatePresence>
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

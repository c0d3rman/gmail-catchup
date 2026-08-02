import { useState, useEffect, useRef } from 'react';
import styles from './AccountMenu.module.css';

interface AccountMenuProps {
  userEmail: string;
  accounts: string[];
  onSwitchAccount: (email: string) => void;
  onAddAccount: () => void;
  onSignOut: () => void;
}

function initialsFor(email: string): string {
  return email.trim().charAt(0).toUpperCase() || '?';
}

export function AccountMenu({
  userEmail,
  accounts,
  onSwitchAccount,
  onAddAccount,
  onSignOut,
}: AccountMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // Show the active account first, then the rest
  const otherAccounts = accounts.filter(a => a.toLowerCase() !== userEmail.toLowerCase());

  return (
    <div className={styles.container} ref={containerRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setIsOpen(open => !open)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title={userEmail}
      >
        <span className={styles.avatar}>{initialsFor(userEmail)}</span>
        <span className={styles.email}>{userEmail}</span>
        <span className={`${styles.caret} ${isOpen ? styles.caretOpen : ''}`} aria-hidden="true">
          ▾
        </span>
      </button>

      {isOpen && (
        <div className={styles.menu} role="menu">
          <div className={styles.section}>
            <div className={`${styles.account} ${styles.activeAccount}`}>
              <span className={styles.avatar}>{initialsFor(userEmail)}</span>
              <span className={styles.accountEmail}>{userEmail}</span>
              <span className={styles.check} aria-hidden="true">✓</span>
            </div>

            {otherAccounts.map(account => (
              <button
                type="button"
                key={account}
                role="menuitem"
                className={styles.account}
                onClick={() => {
                  setIsOpen(false);
                  onSwitchAccount(account);
                }}
              >
                <span className={styles.avatar}>{initialsFor(account)}</span>
                <span className={styles.accountEmail}>{account}</span>
              </button>
            ))}
          </div>

          <div className={styles.divider} />

          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={() => {
              setIsOpen(false);
              onAddAccount();
            }}
          >
            Add another account
          </button>
          <button
            type="button"
            role="menuitem"
            className={`${styles.menuItem} ${styles.danger}`}
            onClick={() => {
              setIsOpen(false);
              onSignOut();
            }}
          >
            Sign out of {userEmail}
          </button>
        </div>
      )}
    </div>
  );
}

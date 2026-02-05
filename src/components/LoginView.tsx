import { useState } from 'react';
import styles from './LoginView.module.css';

interface LoginViewProps {
  clientId: string;
  hasClientId: boolean;
  error: string | null;
  onSaveClientId: (id: string) => void;
  onSignIn: () => void;
}

export function LoginView({
  clientId,
  hasClientId,
  error,
  onSaveClientId,
  onSignIn,
}: LoginViewProps) {
  const [inputClientId, setInputClientId] = useState(clientId);
  const [showSetup, setShowSetup] = useState(!hasClientId);

  const handleSubmitClientId = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputClientId.trim()) {
      onSaveClientId(inputClientId.trim());
      setShowSetup(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <div className={styles.logo}>Gmail Catch Up</div>
        <p className={styles.tagline}>
          Swipe through your unread emails like never before
        </p>

        {error && <div className={styles.error}>{error}</div>}

        {showSetup ? (
          <div className={styles.setup}>
            <h2>Setup Required</h2>
            <p className={styles.setupDescription}>
              To use Gmail Catch Up, you need to create a Google Cloud OAuth Client ID.
              This is a one-time setup that keeps your data secure.
            </p>

            <div className={styles.instructions}>
              <h3>How to get your Client ID:</h3>
              <ol>
                <li>
                  Go to{' '}
                  <a
                    href="https://console.cloud.google.com/apis/credentials"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Google Cloud Console
                  </a>
                </li>
                <li>Create a new project (or select existing)</li>
                <li>Enable the Gmail API for your project</li>
                <li>Go to "OAuth consent screen" and configure it</li>
                <li>Go to "Credentials" and create an OAuth 2.0 Client ID</li>
                <li>Choose "Web application" as the type</li>
                <li>
                  Add <code>{window.location.origin}</code> to "Authorized JavaScript
                  origins"
                </li>
                <li>
                  Add <code>{window.location.origin + window.location.pathname}</code> to
                  "Authorized redirect URIs"
                </li>
                <li>Copy the Client ID and paste it below</li>
              </ol>
            </div>

            <form onSubmit={handleSubmitClientId} className={styles.form}>
              <input
                type="text"
                value={inputClientId}
                onChange={e => setInputClientId(e.target.value)}
                placeholder="Enter your Google Client ID"
                className={styles.input}
              />
              <button type="submit" className={styles.saveButton}>
                Save Client ID
              </button>
            </form>
          </div>
        ) : (
          <div className={styles.signIn}>
            <button onClick={onSignIn} className={styles.signInButton}>
              <svg
                className={styles.googleIcon}
                viewBox="0 0 24 24"
                width="24"
                height="24"
              >
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Sign in with Google
            </button>

            <button
              onClick={() => setShowSetup(true)}
              className={styles.changeClientIdButton}
            >
              Change Client ID
            </button>
          </div>
        )}

        <div className={styles.features}>
          <div className={styles.feature}>
            <span className={styles.featureIcon}>Swipe</span>
            <span>Swipe right to archive</span>
          </div>
          <div className={styles.feature}>
            <span className={styles.featureIcon}>Skip</span>
            <span>Swipe left to save for later</span>
          </div>
          <div className={styles.feature}>
            <span className={styles.featureIcon}>Fast</span>
            <span>Process emails in seconds</span>
          </div>
        </div>
      </div>
    </div>
  );
}

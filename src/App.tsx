import { useGoogleAuth } from './hooks/useGoogleAuth';
import { LoginView } from './components/LoginView';
import { CatchUpView } from './components/CatchUpView';
import './App.css';

function App() {
  const {
    isAuthenticated,
    isLoading,
    accessToken,
    userEmail,
    accounts,
    error,
    signIn,
    signOut,
    addAccount,
    switchAccount,
  } = useGoogleAuth();

  if (isLoading) {
    return null;
  }

  if (!isAuthenticated || !accessToken || !userEmail) {
    return (
      <LoginView
        error={error}
        onSignIn={signIn}
      />
    );
  }

  return (
    <CatchUpView
      // Remount on account change so no state leaks between accounts
      key={userEmail}
      accessToken={accessToken}
      userEmail={userEmail}
      accounts={accounts}
      onSwitchAccount={switchAccount}
      onAddAccount={addAccount}
      onSignOut={signOut}
    />
  );
}

export default App;

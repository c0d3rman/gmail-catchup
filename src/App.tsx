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
    error,
    signIn,
    signOut,
  } = useGoogleAuth();

  if (isLoading) {
    return null;
  }

  if (!isAuthenticated || !accessToken) {
    return (
      <LoginView
        error={error}
        onSignIn={signIn}
      />
    );
  }

  return (
    <CatchUpView
      accessToken={accessToken}
      userEmail={userEmail}
      onSignOut={signOut}
    />
  );
}

export default App;

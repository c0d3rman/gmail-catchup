import { useGoogleAuth } from './hooks/useGoogleAuth';
import { LoginView } from './components/LoginView';
import { CatchUpView } from './components/CatchUpView';
import './App.css';

function App() {
  const {
    isAuthenticated,
    accessToken,
    userEmail,
    error,
    clientId,
    hasClientId,
    saveClientId,
    signIn,
    signOut,
  } = useGoogleAuth();

  if (!isAuthenticated || !accessToken) {
    return (
      <LoginView
        clientId={clientId}
        hasClientId={hasClientId}
        error={error}
        onSaveClientId={saveClientId}
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

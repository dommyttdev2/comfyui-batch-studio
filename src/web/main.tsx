import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api';
import './workspace.css';
function App() {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [user, setUser] = useState('');
  return (
    <main>
      <h1>Batch Studio</h1>
      {!user ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void api
              .login(token)
              .then(() => {
                setToken('');
                setUser(api.userId);
              })
              .catch((e) => setError(e.message));
          }}
        >
          <label>
            アクセストークン
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </label>
          <button>ログイン</button>
        </form>
      ) : (
        <p>ログイン済み: {user}</p>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);

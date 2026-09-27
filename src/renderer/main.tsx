import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AssistantPane } from './AssistantPane';
import { CodexPane } from './CodexPane';
import { StandaloneToolApp, standaloneToolFromSearch } from './StandaloneToolApp';
import './styles.css';
import './scrollbars.css';
import './home.css';
import './environment-settings.css';
import './service-integrations.css';
const standaloneTool = standaloneToolFromSearch(window.location.search);
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).has('assistant-pane') ? (
      <AssistantPane />
    ) : new URLSearchParams(window.location.search).has('codex-pane') ? (
      <CodexPane />
    ) : standaloneTool ? (
      <StandaloneToolApp tool={standaloneTool} />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);

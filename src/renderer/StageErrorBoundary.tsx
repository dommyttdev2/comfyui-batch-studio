import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  stage: string;
  onRetry: () => void;
  children: ReactNode;
};

type State = { error: Error | null };

/**
 * Isolate renderer errors to the active stage. A malformed artifact must not
 * unmount the project navigation or require restarting the application.
 */
export class StageErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Failed to render stage ${this.props.stage}`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="panel" role="alert">
        <h3>{this.props.stage} の表示に失敗しました</h3>
        <p>読み込んだデータの形式や画面描画で問題が発生しました。ほかの工程は引き続き操作できます。</p>
        <div className="issue error">{this.state.error.message || '不明な描画エラー'}</div>
        <button type="button" onClick={this.props.onRetry}>工程を再読み込み</button>
      </section>
    );
  }
}

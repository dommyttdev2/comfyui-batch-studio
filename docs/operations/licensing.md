# ライセンスと配布

## MITの適用範囲

ルートのLICENSEはdommyttdev2が権利を保有するBatch Studioの自作コード、テスト、スクリプト、文書、設定、JSONテンプレートとPSD/PNGテンプレートに適用します。第三者構成要素をMITへ変更するものではありません。PSDのフォント名参照はフォントファイルの提供ではなく、使用環境のフォント条件に従います。

package.jsonのprivate:trueはnpmへの誤公開防止として維持します。通常のライセンス整備でアプリのバージョンは変更しません。

## 第三者通知の正本

- licenses/third-party.jsonはpackage-lock.jsonの全依存（runtime、optional、development）について、バージョン・取得URL・integrity・出典・通知本文を記録する正本です。
- THIRD_PARTY_NOTICES.mdはこのデータから生成します。同じ本文はSHA-256で集約し、各パッケージから参照します。生成Markdownは行末のスペース・タブを除去しますが、正本データの本文とハッシュは保持します。
- 通知本文の著作権表示・条件・免責を保持します。本文内の第三者用語を翻訳・書き換えません。
- ag-psdのJPEG実装のApache本文、bcrypt-pbkdfのOpenBSD由来本文、cpu-features内のApache/BSD本文も含めます。
- MPLのlightningcssは開発依存です。ツールやそのバイナリを配布する場合はMPL対象ソースの提供・入手案内を含めます。固定npmアーカイブと、その中のpackage.jsonに記載された上流を辿って該当ソースを確認してください。

## 依存更新時

1. 新しいlockfileの各resolvedアーカイブを取得し、integrityで照合します。インストールスクリプトの実行は通知収集には不要です。
2. 追加・変更した依存のLICENSE/COPYING/NOTICEと同梱コードの追加表記を確認します。パッケージの代表licenseだけでは判断しません。
3. licenses/third-party.jsonの該当記録と本文を更新します。本文はLFに統一し、前後の空白を除いたあと末尾LFを一つ付け、そのUTF-8 SHA-256をキーにします。出典は固定アーカイブ内のパスまたは固定上流コミットを記録します。
4. npm run licenses:generate、npm run licenses:check、npm run test:licensesを実行し、差分をレビューします。収録するNOTICE等が増えた場合も本文を保持します。

licenses:checkは全依存のpath/version/integrity/resolved/dev/license表記と本文ハッシュを照合します。本文・出典の法的十分性や、ネイティブバイナリにリンクされた全構成要素を自動で保証するものではありません。

## 上流通知の不足

固定版の@electron-internal/extract-zip 1.0.5と@epic-web/invariant 1.0.0はライセンスを宣言していますが、アーカイブと公開コミットに完全なLICENSE本文がありません。通知集にその状態を明記し、著作権者や年を捏造しません。これらは開発依存であり、自作ソースをMITで公開することを妨げません。ツール本体・node_modules全体を再配布する際は上流の完全な通知を取得してください。

native Biome/Rolldownパッケージには親プロジェクトの通知を収録しています。個別にリンクされたRust/C/C++構成要素の監査を完了したという意味ではありません。開発ツール・ビルド環境自体を配布する場合は、その出荷対象の追加監査が必要です。

## 配布物への収録

scripts/copy-runtime.cjsは最初に通知の整合性を確認し、dist-electronへLICENSEとTHIRD_PARTY_NOTICES.mdをコピーします。Electronのダウンロード済み配布物からLICENSEとLICENSES.chromium.htmlをdist-electron/licenses/electronへそのままコピーします。必要な本文が欠けている場合は処理を停止します。

ZIPやインストーラを作る場合はこれらを必ず収録し、他の同梱物も確認します。通知をコピーしただけで、その配布物の全条件を満たすとは限りません。ElectronとChromiumの通知を単一のMIT本文で置き換えません。

## 外部構成要素

ComfyUI本体、aria2、Git、GitHub CLI、Grok/Codex CLI、モデル重み・LoRA、利用者の画像・生成物はプロジェクトのMIT対象ではありません。外部プログラムをAPI/subprocessで使う実装と、その本体を再配布する行為を区別します。ComfyUI/aria2等を一体配布する場合はGPL等の条件を別途確認します。

Dockerfileのソース公開と構築済みDockerイメージの配布は別です。イメージ配布ではNode/Debian、aptパッケージ、ネイティブツール等の通知・対応ソースを追加確認してください。

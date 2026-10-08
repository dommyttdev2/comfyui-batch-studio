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

確認日: 2026-10-08。上流通知を固定コミットで追跡し、次の2件を区別します。

- **@electron-internal/extract-zip 1.0.5**: 固定アーカイブとv1.0.5はBSD-2-Clause宣言のみで、完全な本文を含みません。一方、上流は2026-09-10の[PR #19](https://github.com/electron/extract-zip/pull/19)で明示的にMITへ再ライセンスし、著作権表示を含む[LICENSE本文](https://github.com/electron/extract-zip/blob/3c33b76429ebd9bf724bcfc32d3e8fae7eeb3e82/LICENSE)を追加しました。この本文を通知集へ収録しています。[v1.0.5からの差分](https://github.com/electron/extract-zip/compare/v1.0.5...3c33b76429ebd9bf724bcfc32d3e8fae7eeb3e82)はCargo.toml、package.json、README.md、LICENSEのみで、実装ソースは同一です。ただし固定アーカイブのBSD宣言をMITへ書き換えず、後日のMIT本文をBSD本文として扱いません。ツール本体や既存ネイティブバイナリを配布するときは、適用する上流許諾とリンクされた構成要素を確認します。
- **@epic-web/invariant 1.0.0**: [npmの公式メタデータ](https://registry.npmjs.org/@epic-web%2finvariant/1.0.0)のlicenseはMITです。[固定タグ](https://github.com/epicweb-dev/invariant/tree/547be2246d3c39f8ca44dd0502b1aa70bf4378af)と[確認時のmain](https://github.com/epicweb-dev/invariant/tree/d0cf40958972afb909fb14b2afc85d8c5f1ff5d6)の全ファイル、およびLICENSEの履歴を確認しましたが、完全な本文はありません。READMEはMITを宣言し、存在しないmain/LICENSEへリンクしています。著作権者・年を推定して補完せず、本文未取得として通知集に明記します。この依存を再配布する際は上流の完全な通知を取得してください。

どちらも開発依存です。上流通知の不足や固定版との差異を、自作ソースにMITを適用することと混同しません。

native Biome/Rolldownパッケージには親プロジェクトの通知を収録しています。個別にリンクされたRust/C/C++構成要素の監査を完了したという意味ではありません。開発ツール・ビルド環境自体を配布する場合は、その出荷対象の追加監査が必要です。

## 配布物への収録

scripts/copy-runtime.cjsは最初に通知の整合性を確認し、dist-electronへLICENSEとTHIRD_PARTY_NOTICES.mdをコピーします。Electronのダウンロード済み配布物からLICENSEとLICENSES.chromium.htmlをdist-electron/licenses/electronへそのままコピーします。必要な本文が欠けている場合は処理を停止します。

ZIPやインストーラを作る場合はこれらを必ず収録し、他の同梱物も確認します。通知をコピーしただけで、その配布物の全条件を満たすとは限りません。ElectronとChromiumの通知を単一のMIT本文で置き換えません。

## 外部構成要素

ComfyUI本体、aria2、Git、GitHub CLI、Grok/Codex CLI、モデル重み・LoRA、利用者の画像・生成物はプロジェクトのMIT対象ではありません。外部プログラムをAPI/subprocessで使う実装と、その本体を再配布する行為を区別します。ComfyUI/aria2等を一体配布する場合はGPL等の条件を別途確認します。

Dockerfileのソース公開と構築済みDockerイメージの配布は別です。イメージ配布ではNode/Debian、aptパッケージ、ネイティブツール等の通知・対応ソースを追加確認してください。

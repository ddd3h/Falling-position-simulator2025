# WASA BFPS / Balloon Falling Position Simulator

CUSFが公開しているサイト(https://predict.sondehub.org/ )を自団体用に調整し、いくつか機能を追加したものです。
大きな変更点としては、日本語化、JSTに対応、繰り返し予測(Prediction Type)の中にGaussian_distributionを追加しました。Gaussian_distributionは上昇速度の±0.5m,バースト高度の±5%,降下速度の±0.5mの範囲で正規分布に対応させランダムで実行した結果を表示しています。中心点は赤色、中心に近いほど白、それ以外の色はRGBに対応しており、Rが上昇速度のσ、Gがバースト高度のσ、Bが降下速度のσに対応して色をプロットさせてます。

サイトの中身は以下のリンクから確認できます！
https://wasa-rockoon.github.io/Falling-position-simulator/

## GitHub Pagesでの公開
このリポジトリでは GitHub Actions を利用して GitHub Pages に自動デプロイされます。
main ブランチに push するとワークフローが実行され、最新のファイルが公開されます。
リポジトリの Settings > Pages で「Build and deployment」→「Source」を "GitHub Actions" に設定してください。

##　Upcoming Feature
今後自分が実装したいものを記入していきます。
・ガス計算シートの実装
・CUSFが提供しているAPIの実装
・リアルタイム予測の対応
・誤差の修正

要望はXのDMまでお願いします。

## License
GNU General Public License

## Contact
https://x.com/wasa_rocket

# HABSIM
高高度気球シミュレータ
http://habsim.org

## 概要
これはStanford Space InitiativeのBalloonsチームのために開発された予測サーバである。既存の予測サーバーと比較して、この予測サーバーの目的は以下の通りです：

- モンテカルロ GEFS ランセットに基づく確率的予測を提供する。
- GEFSが許容する最大時間窓（+378時間）までの予測を提供する。
- 上昇率、継続時間、シミュレーションステップ、ドリフト係数など、シミュレーションパラメータをより細かく、より広範に制御できる。
- 任意の飛行プロファイルのシミュレーションに使用できる直感的な予測APIをエクスポート。
- APIの機能性と柔軟性を取り込んだウェブベースのUIを提供。

## ステータス / 運用
サーバーは ftp://ftp.ncep.noaa.gov/pub/data/nccf/com/gens/prod から GEFS データを 6 時間ごとに自動的にダウンロードし、管理している。データは通常、GEFSのタイムスタンプから6時間後に利用可能になる。これはhttp://habsim.org/which で確認できる。
ダウンロードの進捗状況は http://habsim.org/ls で手動で確認できる。

## APIの使用法
### `/singlepredicth` を実行する。
#### 引数
UTC 打ち上げ時刻 (`yr`, `mo`, `day`, `hr`, `mn`), 場所 (`lat`, `lon`), 打ち上げ標高 (`alt`), ドリフト係数 (`coeff`), 最大継続時間 (`dur`), ステップ間隔 (`step`), GEFS モデル番号 (`model`).

#### 戻り値
loc1, loc2 ...]` のリストで、各 loc は `[UNIX_timestamp, lat, lon, altitude, u-wind, v-wind]` のリストである。リストは飛行時間が経過するか、高度が地上高度を下回ると終了する。データセットの時間境界を超えた場合はエラーが返される。

注意：
u-wind` は東向きの風: X正方向の風ベクトルである。
v-wind` は北向きの風: 正の Y 方向の風ベクトルです。

### `/singlepredict`
時刻がUNIXタイムスタンプ(`timestamp`)として渡される以外は上記と同じ。

### `/spaceshot`
#### 引数
打ち上げ時刻 (`timestamp`)、打ち上げ位置 (`lat`, `lon`)、打ち上げ高度 (`alt`)、平衡高度 (`equil`)、平衡高度での滞在時間 (`eqtime`)、上昇速度 (`asc`)、下降速度 (`desc`)。

降下率は-dh/dtであることに注意。つまり、気球が落下している場合は `desc` > 0 となる。

#### 戻り値
`[path1, path2, ... path20]` のリストであり、各 path は 3 つのパス `[rise, equil, fall]` のリストである。各パスはリスト `[loc1, loc2 ...]` であり、各 `loc` は上記のようにリスト `[UNIX_timestamp, lat, lon, altitude, u-wind, v-wind]` である。

平衡高度が打ち上げ高度より低い場合、上昇パスの長さはゼロとなり、平衡パスは打ち上げ高度から始まる。

平衡時間がゼロの場合、平衡経路の長さはゼロとなり、落下経路は上昇の最後のデータポイントの高度から始まる（上昇の長さもゼロでない限り、その場合は打ち上げ高度から始まる）。

### `/elev`
#### 引数
緯度、経度

#### 戻り値
その地点の標高を文字列で返す。標高データの解像度は1度あたり120ポイントで、補間されずに丸められます。すべての標高データが利用できるわけではない。https://web.stanford.edu/~bjing/elev. これらのファイル外の場所は標高0として報告されます。

### `/windensemble`
#### 引数
時刻 (`yr`、`mo`、`day`、`hr`、`mn`)、位置 (`lat`、`lon`)、高度 (`alt`) 。

#### 戻り値
u-wind, v-wind, du/dh, dv/dh]`, ここで

- u-wind = [u-wind-1, u-wind-2, u-wind-3...u-wind-20]`.
- v-wind＝[v-wind-1、v-wind-2、v-wind-3...v-wind-20]`である。
- du/dh＝[du/dh-1、du/dh-2、du/dh-3...du/dh-20]`である。
- dv/dh = [dv/dh-1, dv/dh-2, dv/dh-3...dv/dh-20]`.

ここで、数字はデータを抽出したGEFSモデルである。

注意
u-wind`は東寄りの風：正のX方向の風ベクトル。
v-wind`は北寄りの風：正のY方向の風ベクトル。

微分は、風の層間を（高度に関して）線形補間することによって近似される。GEFSの風データは1度あたり1点の分解能を持つ。データは4次元すべてで補間され、特に実際の風は気圧に関して補間される。

### 実際の風は気圧に対して補間される。
windensembleと同様であるが、モデルパラメータ(`model`)を受け取り、そのモデルのデータのみを返す。

### `/which`
GFS のタイムスタンプを返す。

### サーバーの状態を返す。
サーバーのステータスを返す

## ファイル

### api.py
上記の API をエクスポートし、ダウンローダーサービスを初期化する

### downloader.py
コマンドラインの引数[年 月 日 時]を受け取り、ftp://ftp.ncep.noaa.gov/pub/data/nccf/com/gens/prod からディレクトリ gefs/ にある GEFS タイムスタンプに対応するデータセット全体をダウンロードする。マルチプロセッシングと、早すぎる実行、破損したデータ、ダウンロードの中断を含む幅広い例外処理を実装しています。データセット全体をnpyに変換。

### downloaderd.py
デーモンのようなダウンローダーサービス。新しいデータセットごとにdownloader.pyを繰り返し実行します。

### elev.py
.npyファイルから標高データを取得するためのツール。ファイル名と内容はhttps://topotools.cr.usgs.gov/gmted_viewer/viewer.htm、.npy形式に変換されたものでなければなりません。使用法: getElevation(lat, lon)関数をエクスポートします。補間なし、1/120度単位で丸める。

### インターフェース
予測サーバの UI インターフェース。

### simulate.py
コア sim モジュール。

## 注意事項

### eccodes/pygribのインストール
このサーバの目的は、eccodes/pygribを1台のコンピュータで実行し、grb2ファイルを展開することです。

それでも自分でやりたい場合は、eccodes: https://confluence.ecmwf.int//display/ECC/Releases をダウンロードしてインストールしてください。
指示に従って tar を解凍し、eccodes をインストールしてください。CMakeとgfortranがインストールされていることを確認してください。

pygribのインストールを容易にするために、eccodesをプリプロセッサ/リンカのパスにインストールするか、eccodesディレクトリにパスを設定してください。

### サーバの実行
docker build . -t habsim-root`
docker run -d -v $(pwd):/home/run -v /gefs:/gefs --name=habsim-$USER -p 80:5000 habsim-root`.
`python3 downloaderd.py --dlogfile=/var/log/downloaderd.log --logfile=/var/log/downloader.log --savedir=/gefs/gefs --statusfile=/gefs/whichgefs`.

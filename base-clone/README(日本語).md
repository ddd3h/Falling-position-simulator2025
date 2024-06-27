# CUSF スタンドアロン予測 - バージョン 2

ケンブリッジ大学スペースフライト着陸予測 - ラテックス気象観測気球の飛行経路と着陸位置を予測するためのウェブベースのツールです。 

## インストール

予測器自体のソースは `pred_src/` にあり、ビルド方法はそこにあります。 

以下の項目は、Predictorを実行するユーザーによって実行可能(`chmod +x ./predict.py`)である必要があります：  

* `predict.py`
* `pred_src/pred` (コンパイル済み)
* `cron/clear-pydap-cache-cronjob.sh`
* `cron/purge-predictions-cronjob.sh` を実行する。

predict/preds/` ディレクトリと `gfs/` ディレクトリは PHP インタプリタと `predict.py` python スクリプトが rwx でアクセスできる必要がある。requirements.txtに記載されているpythonの依存関係をインストールする必要があります。PyDAPの場合、正確なバージョンが重要です：

    pip install -r requirements.txt

それ以外は、このリポジトリをウェブからアクセスできないフォルダにクローンし、リポジトリの `predict/` ディレクトリにシンボリックリンクを作成するだけです。 

predict/includes/config.inc.php`には便利な設定オプションがあります。 

## 情報

cron/`ディレクトリにある2つのシェルスクリプトは両方とも毎日実行する必要がある。`clear-pydap-cache-cronjob.sh` は pydap が使用するキャッシュをクリアし、古いデータが蓄積されないようにする。purge-predictions-cronjob.sh`は過去7日以内にアクセスまたは変更されていないシナリオと予測を削除する。そのため、あるシナリオの予測を再実行すると、そのシナリオの有効期限は7日以上にリセットされる。  

ディレクトリ名は、起動パラメータのSHA1ハッシュで構成されるUUIDであり、予測を再実行すると、新しいディレクトリが作成されるのではなく、既存のディレクトリのデータが上書きされる。 

我々は、NDAPと彼らの[NOMADS](http://nomads.ncep.noaa.gov)配布システム経由でアクセスされたNOAAによって提供されたGFSデータを使用しています。標準予測には[1.0x1.0度データ](http://nomads.ncep.noaa.gov/txt_descriptions/GFS_high_resolution_doc.shtml)(26気圧レベル)を、高解像度(HD)予測には[0.5x0.5度データ](http://nomads.ncep.noaa.gov/txt_descriptions/GFS_half_degree_doc.shtml)(47気圧レベル)を使用します。 

## ライセンス

この作品はフリーソフトウェアです。あなたは、フリーソフトウェア財団によって発行されたGNU一般公衆利用許諾契約書（GNU General Public License）のバージョン2またはそれ以降のバージョンのいずれかに従って、この作品の再配布や改変を行うことができます。本作品は有用であることを期待して頒布されますが、商品性や特定目的への適合性の暗黙の保証すらなく、いかなる保証もありません。 

## クレジットと謝辞

クレジットは個々のファイルに詳述されているが、特に以下の通り：  

* Rich Wareham - 新しいプレディクターと毎時のプレディクター・システム  
* ファーガス・ノーブル、エド・ムーア、その他多数  

Adam Greig - [http://www.randomskk.net](http://www.randomskk.net) - [random@randomskk.net](mailto:random@randomskk.net)  
Jon Sowman - [http://www.hexoc.com](http://www.hexoc.com) - [jon@hexoc.com](mailto:jon@hexoc.com)  

Copyright Cambridge University Spaceflight 2009-2011 - 無断複写・転載を禁じます。
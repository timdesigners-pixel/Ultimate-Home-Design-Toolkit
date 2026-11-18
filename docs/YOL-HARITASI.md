# Yol haritası — tam donanımlı 3B ev tasarım programı

Onay: kullanıcı, 17.11.2026 ("Plan onaylandı"). Fotoğraf gerçekliğinde render için Cycles ana motor olarak kalır; dahili yol izleyici hızlı önizleme, WebGL görünüm anlık çalışma içindir.

Her aşama ayrı PR ile gelir; her aşamada Rust motor testleri, arayüz denetimi (uygulamanın gerçek CSP'siyle), TR/EN dil dosyaları, gerçek ekran görüntüleri ve Windows + Android paketi üretilir. Mevcut `.uhds` projeleri açılmaya devam eder.

| Aşama | Kapsam | Durum |
| --- | --- | --- |
| 1 · Serbest mimari | Her açıda ve eğri duvar, uç noktaya/duvara yapışma, 15° açı kilidi, uzunluğu yazarak çizim, duvar ucunu sürükleme, eğik köşe dolgusu, her şekilde oda algılama, duvar başına yükseklik/kalınlık, her ölçüde kapı/pencere (çift kanat, sürgülü, camlı, sabit, vasistas), plan resmi altlığı ve iki noktayla ölçek, yeni proje türü seçimi | Bu PR |
| 2 · Katlar, çatı, merdiven | Serbest kat sayısı ve kat yükseklikleri, serbest planlarda döşeme/tavan; çatı sihirbazı (düz, beşik, kırma, tek eğimli, mansart, çatı penceresi, saçak), çatı katında eğimli tavan; merdiven sihirbazı (düz, L, U, döner, konfor denetimi, korkuluk, otomatik boşluk) | Sırada |
| 3 · İç mekân donatımı | Mutfak dolap dizisi + otomatik tezgâh, banyo tasarımcısı, asma tavan/kartonpiyer/süpürgelik/duvar paneli, lümen ve renk sıcaklığıyla ışık tasarımı (Cycles'a gerçek değerler), kütüphane: favoriler, kendi kütüphanem, gruplama | — |
| 4 · Dış mekân ve arsa | Arsa sınırı, kot noktalarıyla zemin, teras/yol, çit, havuz, bitki, pergole, tarihe göre güneş ve gölge incelemesi | — |
| 5 · Çizim ve çıktı | Ölçülü kat planı, kesit, görünüş, antetli pafta; PDF, DXF, SVG, PNG; mahal ve malzeme listesi | — |
| 6 · Sunum ve render | Cycles sahne ön ayarları, Poly Haven HDRI, kamera noktaları ve toplu render, 360° panorama, yürüyüş ve tur videosu; çoklu seçim, hizalama, katmanlar, kısayollar, geri alma geçmişi; Android'de iki parmakla yakınlaştırma/döndürme | — |

## Kararlar

- Sıra 1 → 6.
- Yeni projede "Serbest / Modüler / Tiny House / Van" seçimi; modül sistemi duvar ağı üreten bir şablon olarak kalır.
- DWG yerine DXF (DWG lisans gerektirir).
- Android: çizim, düzenleme ve 3B tam; Cycles ve ağır çıktılar (pafta, video) yalnız Windows.
- Kütüphane: CC0 içerik ve parametrik modeller; marka ürünleri izinle.

## Aşama 1 teknik notları

- `Wall::arc` (mm): kirişin ortasından yay tepesine uzaklık; + sola, − sağa büker. Hesap ve 3B için `walls::expand` eğri duvarı ≤ 6°'lik düz parçalara böler; `Wall::length` yay uzunluğudur.
- Oda algılama ızgara taramasıdır; eğik/eğri kenarlardaki basamaklar Douglas–Peucker ile sadeleştirilir, dik kenarlar aynen kalır.
- Eğik birleşimlerde köşe dolgusu (`walls::corner_fills`): birleşen duvar uç yüzlerinin dışbükey zarfı.
- Eğri duvara açıklık konmaz (`@opening_on_curved_wall`).
- Plan altlığı sahnede (`Scene::underlays`) en çok 2400 piksel JPEG olarak saklanır.
- Bilinen eksik: serbest planlarda döşeme/tavan plağı yok (yalnız adlandırılmış odanın zemin kaplaması çizilir); Aşama 2'de gelir.

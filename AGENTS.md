# Ultimate Home Design Toolkit (PL-060) — ajan kuralları

> **MUST HAVE:** Bu proje PluginLabs ortak şartnamesine tabidir: [MUST-HAVE.md](MUST-HAVE.md). Maddelerden biri karşılanmadan iş tamamlandı sayılmaz. Ortak kurallar: [PluginLabs/AGENTS.md](https://github.com/timdesigners-pixel/PluginLabs/blob/main/AGENTS.md).

## Bu depoya özgü
- Yığın: Rust motoru (`engine/`, tek giriş noktası `api::call`), Tauri 2 masaüstü kabuğu (`src-tauri/`), arayüz `ui/`, tarayıcı önizlemesi için WebAssembly köprüsü (`wasm/`), Cycles köprüsü (`cycles/uhd_cycles.py`).
- Ürün kartı ve PluginLabs kaydı: [docs/URUN-KARTI.md](docs/URUN-KARTI.md); PluginLabs içindeki `apps/07-yeni-urunler/PL-060-ultimate-home-design-toolkit/README.md` ve `registry/projects.json` bu depoyu gösterir.
- Denetimler: `cargo test -p uhd-engine --release`, `node scripts/i18n-check.cjs`, `bash scripts/build-wasm.sh && node scripts/ui-check.cjs` (Chromium, gerçek motor, tek kullanımlık veri).
- Metinler yalnız `ui/locales/tr.json` ve `ui/locales/en.json` içindedir; motor iletileri `@anahtar` biçimindedir. Kodda arayüz metni yazılmaz.
- `ui/pl/` dosyaları PluginLabs tasarım sisteminin kanonik kopyasıdır; elle düzenlenmez. UI işinde `pluginlabs-advanced` skill'i okunur; yalnız `--pl-` tokenları ve `pl-` sınıfları.
- Güvenlik sınırları (gevşetilmez):
  - Ağ: PluginLabs Hub `127.0.0.1:47632` ve Poly Haven izinli konakları (`api.polyhaven.com`, `dl.polyhaven.org`); yönlendirme kapalı, boyut ve md5 denetimi.
  - MyMind yalnız Hub üzerinden, önizleme → açık onay → yalnız önizlenen metin; fiyat, yol, not ve proje numarası gönderilmez.
  - Genişleme paketi lisansları Ed25519 imzalıdır; motor yalnız gömülü yayıncı anahtarlarına (`engine/data/pack-keys.json`) güvenir. Önizleme anahtarı yalnız tarayıcı test düzeneğinde kabul edilir. Özel imza anahtarı depoya girmez.
  - İndirilen model/doku dosyaları veri olarak okunur, çalıştırılmaz; glTF yolları klasör dışına çıkamaz.
- Silme yok: öğeler arşivlenir, “Geri al” ile döner.
- Derleme çıktıları (`target/`, `dist/`, `ui/engine/`), özel anahtarlar ve kullanıcı verisi depoya eklenmez.

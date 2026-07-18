# การปล่อยรีลีส (Releasing)

ขั้นตอนการออกเวอร์ชันใหม่ของ FluxNode พร้อม **signed auto-update** ผ่าน
`tauri-plugin-updater`. เอกสารนี้อธิบายตามสิ่งที่ repo ตั้งค่าไว้จริง —
`.github/workflows/release.yml`, `src-tauri/tauri.conf.json`, และ flow ฝั่งแอปใน
`src/services/ipc/app-auto-update.ts`.

> โค้ดเซ็นเพื่อ **SmartScreen / Authenticode** เป็นคนละเรื่องกับ updater signature ใน
> เอกสารนี้ — ดู [SIGNING.md](SIGNING.md). เอกสารนี้ครอบคลุมเฉพาะ updater signature
> (ที่ทำให้ auto-update ทำงาน) เท่านั้น.

---

## ครั้งแรกครั้งเดียว: ตั้งค่า signing secrets

Auto-update จะทำงานก็ต่อเมื่อ artifact ถูกเซ็นด้วย private key ที่คู่กับ public key
ซึ่งฝังไว้แล้วใน `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). ทำครั้งเดียว:

1. Private key อยู่ที่ `~/.tauri/fluxnode-updater.key` (บนเครื่อง dev — **ห้าม** commit เข้า repo).
2. เพิ่ม GitHub Secrets ที่ **repo → Settings → Secrets and variables → Actions**:
   | Secret | ค่า |
   | --- | --- |
   | `TAURI_SIGNING_PRIVATE_KEY` | เนื้อหาทั้งไฟล์ `~/.tauri/fluxnode-updater.key` |
   | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | รหัสผ่านของ key (ถ้าตอนสร้างไม่ได้ตั้ง ให้ใส่ค่าว่าง หรือไม่ต้องเพิ่ม secret นี้) |
3. **สำรอง private key ไว้นอกเครื่อง** ในที่ปลอดภัย. ถ้า key หาย จะเซ็น update ที่
   client เดิมยอมรับต่อไม่ได้อีกเลย — ผู้ใช้ทุกคนต้องติดตั้งใหม่ด้วยมือ.

> ถ้า secrets ยังไม่ตั้ง: workflow ยัง build ผ่าน แต่ **ไม่มีไฟล์ `.sig`** — auto-update
> จะใช้ไม่ได้ (client ปฏิเสธ artifact ที่ไม่ได้เซ็น).

---

## ทุกครั้งที่ปล่อยรีลีส

### 1. Bump เวอร์ชัน (สองไฟล์ต้องตรงกัน)

- `package.json` → `"version"`
- `src-tauri/tauri.conf.json` → `"version"`

ทั้งสองไฟล์ปัจจุบันคือ `0.1.0`. ใช้ [SemVer](https://semver.org): patch สำหรับแก้บั๊ก,
minor สำหรับฟีเจอร์, major สำหรับ breaking change. อัปเดต [CHANGELOG.md](CHANGELOG.md) ด้วย.

> updater เทียบเวอร์ชันจากค่านี้ — ถ้าไม่ bump ให้สูงกว่าที่ผู้ใช้มีอยู่ client จะไม่เห็น
> ว่ามี update.

### 2. ตรวจก่อน tag (gate เดียวกับ CI)

```bash
npm run build      # tsc + vite
npm run lint       # oxlint
npm test           # vitest
```

### 3. Commit + สร้าง tag

รีลีสจะ trigger จากการ push **tag ที่ขึ้นต้นด้วย `v`** (ดู `on.push.tags: ['v*']`).

```bash
git commit -am "chore(release): v0.1.1"
git tag v0.1.1
git push origin master
git push origin v0.1.1
```

> tag ต้องตรงกับเวอร์ชันในไฟล์ (`v0.1.1` ↔ `"version": "0.1.1"`). release name บน GitHub
> จะกลายเป็น `FluxNode v0.1.1` อัตโนมัติ.

### 4. รอ workflow เสร็จ

`.github/workflows/release.yml` จะ build ด้วย `tauri-apps/tauri-action`, เซ็น artifact,
สร้าง `latest.json`, และเปิด **draft release** พร้อมแนบไฟล์.

```bash
gh run watch                          # ดู progress
gh release view v0.1.1                # ดู draft ที่สร้าง
```

### 5. เผยแพร่ (publish) draft — ขั้นที่ทำให้ผู้ใช้เห็น update

รีลีสถูกสร้างเป็น **draft** (`releaseDraft: true`). แอปของผู้ใช้ poll ที่:

```
https://github.com/Freshair129/fluxnode-dev/releases/latest/download/latest.json
```

**assets บน draft ยังเข้าถึงจาก URL นั้นไม่ได้** — client จะเริ่มเห็น update ก็ต่อเมื่อ
กด publish. ตรวจ draft (โน้ต, ไฟล์ installer + `.sig` + `latest.json` ครบ) แล้วจึง:

```bash
gh release edit v0.1.1 --draft=false
```

หรือกด **Publish release** ในหน้า GitHub Releases.

---

## ฝั่งผู้ใช้เห็นอะไร

- ตอนเปิดแอป ~8 วินาที มีการเช็ก update แบบเงียบ (`App.tsx` → `checkForAppUpdates({ silent: true })`) —
  ไม่มีเสียงรบกวนถ้าไม่มี update.
- ถ้าเจอเวอร์ชันใหม่: แจ้งเตือน → ดาวน์โหลด → ตรวจลายเซ็น → ติดตั้ง → relaunch ในตัว.
- เช็กเองได้ที่ status bar → **Updates** (`AppUpdatesDrawer`).

---

## ข้อจำกัดปัจจุบัน (ต้องรู้ก่อนอ้างว่า cross-platform)

- **Windows เท่านั้น** ที่ build ได้จริงตอนนี้ — `bundle.targets` มีแค่ `["nsis", "msi"]`
  และ `scripts/fetch-ffmpeg.ps1` เป็น Windows-only. เลก macOS/Linux ใน matrix จะยังไม่
  ผลิต bundle จนกว่าจะเพิ่ม bundle targets ใน `tauri.conf.json` + `scripts/fetch-ffmpeg.sh`
  สำหรับ populate `src-tauri/binaries/`.
- **Authenticode / SmartScreen** ยังไม่ได้เซ็น — installer จะขึ้นเตือน "unknown publisher".
  แยกจาก updater signature; ดู [SIGNING.md](SIGNING.md) (แนะนำ Azure Trusted Signing).

---

## แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
| --- | --- |
| Build ไม่มีไฟล์ `.sig` | ยังไม่ตั้ง `TAURI_SIGNING_PRIVATE_KEY` secret |
| Client ไม่เห็น update | ลืม publish draft, หรือไม่ได้ bump version ให้สูงขึ้น, หรือ tag/version ไม่ตรงกัน |
| Workflow ไม่ trigger | tag ไม่ขึ้นต้นด้วย `v`, หรือ push แต่ commit ไม่ได้ push tag (`git push origin <tag>`) |
| `latest.json` 404 | release ยังเป็น draft — publish ก่อน |
| อยากถอนรีลีส | ลบ/แปลง draft กลับ, หรือ `gh release delete v0.1.1` ก่อน publish |

# Code Signing & Windows SmartScreen

FluxNode ships as an unsigned installer today. Windows SmartScreen shows an
"unknown publisher" warning for unsigned (and low-reputation) apps. This guide
explains how to sign the build and what each option does to SmartScreen.

> **The honest truth about SmartScreen:** signing alone does **not** instantly
> remove the warning. SmartScreen trusts a publisher based on *reputation*.
> - **Unsigned / self-signed:** always warns. (Self-signed is for local testing only.)
> - **OV (Organization Validation) certificate:** warning persists until your
>   signature accumulates enough download reputation (can take weeks/many installs).
> - **EV (Extended Validation) certificate** or **Azure Trusted Signing:** grants
>   reputation immediately — the warning is gone on day one. This is the only way
>   to skip the warning for a brand-new app.

## Certificate options

| Option | Cost | SmartScreen | Notes |
|--------|------|-------------|-------|
| Self-signed | free | always warns | local testing only; users must manually trust the cert |
| OV cert (Sectigo/DigiCert) | ~$200–400/yr | warns until reputation builds | cheapest "real" cert; reputation accrues over time |
| **EV cert** | ~$300–600/yr | **passes immediately** | requires a hardware token / HSM; classic instant-trust route |
| **Azure Trusted Signing** | ~$10/mo | **passes immediately** | Microsoft's modern cloud signing; cheapest instant-trust route. **Recommended.** |

For a new commercial product, **Azure Trusted Signing** is usually the best
value (instant reputation, no hardware token, low monthly cost).

## Enabling signing in Tauri (cert in the Windows store: EV / OV / self-signed)

Add a `windows` block to `bundle` in `src-tauri/tauri.conf.json`:

```json
"bundle": {
  "active": true,
  "targets": ["nsis", "msi"],
  "windows": {
    "certificateThumbprint": "REPLACE_WITH_YOUR_CERT_SHA1_THUMBPRINT",
    "digestAlgorithm": "sha256",
    "timestampUrl": "http://timestamp.digicert.com"
  }
}
```

- `certificateThumbprint` is the SHA-1 thumbprint of a cert installed in
  `Cert:\CurrentUser\My` (find it with `Get-ChildItem Cert:\CurrentUser\My`).
- Tauri invokes `signtool.exe` (Windows SDK) automatically during `tauri build`.
- The `timestampUrl` keeps signatures valid after the cert expires.

> Keep `certificateThumbprint` out of committed config / set it on the build
> machine only, so unsigned dev builds keep working.

## Enabling Azure Trusted Signing (recommended)

Use a custom sign command instead of a thumbprint. Install the
`trusted-signing-cli` (or use `signtool` with the Azure dlib), then:

```json
"bundle": {
  "windows": {
    "signCommand": "trusted-signing-cli -e https://<region>.codesigning.azure.net -a <account> -c <cert-profile> %1"
  }
}
```

Authenticate the build environment with Azure credentials (env vars /
`az login`) before running `tauri build`.

## Local test signing (does NOT bypass SmartScreen)

Run `scripts/create-test-cert.ps1` to generate a self-signed cert in your user
store and print its thumbprint. Use it to exercise the signing pipeline locally
— installs will still warn unless you manually trust the cert. Never ship a
self-signed build.

## Verify a signed installer

```powershell
Get-AuthenticodeSignature .\src-tauri\target\release\bundle\nsis\FluxNode_0.1.0_x64-setup.exe
```

`Status` should read `Valid`.

## In-app update download verification (not the same as installer signing, above)

Separately from the installer signing above, FluxNode has an **in-app** "check for update /
download update" flow (`check_for_app_update` / `download_app_update` in `src-tauri/src/lib.rs`).
This flow does **not** use `tauri-plugin-updater` and therefore does **not** verify a publisher
signature on the downloaded package. What it does do (as of this hardening pass):

- **HTTPS-only.** Both the manifest URL and the manifest's `downloadUrl` must be `https://`;
  plain `http://` is rejected outright.
- **Required SHA-256.** The manifest must include a `sha256` field alongside `downloadUrl`.
  `download_app_update` takes an `expected_sha256` argument (from that manifest field), hashes
  the downloaded bytes, and **refuses to write the file to disk** if the hash doesn't match.
- **Response size caps.** Both the manifest fetch and the package download are capped (10MB for
  the JSON manifest, 500MB for the download) to bound memory use against a malicious/broken
  server.
- **Filename sanitization.** The on-disk filename is derived from the URL's final path segment,
  filtered to an alphanumeric/`.`/`-`/`_` whitelist — never the raw URL — so a malicious/MITM'd
  manifest can't use `../` or similar tricks to escape the `updates/` directory.
- **Atomic write.** The verified bytes are written via a temp-file-then-rename so a crash
  mid-download never leaves a partially-written (and therefore unverifiable-looking) file behind.

**What this is not:** proof that the manifest itself came from FluxNode. An attacker who can serve
an arbitrary (but `https`) manifest can still supply their own `sha256` alongside their own
payload — the hash check only proves the bytes match what *the manifest* claimed, not that the
manifest is authentic. Closing that gap requires actual publisher signature verification, i.e.
migrating this flow to **`tauri-plugin-updater`** with a signed update artifact and Tauri's
built-in public-key verification. That migration is the recommended long-term fix and is not yet
done — treat the current hash check as download-integrity hardening, not authentication.

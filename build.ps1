# 1. Obfuscate Frontend HTML & Browser Extension JS from .clean_backup/
node obfuscate.js

# 2. Rename running binaries if locked so Windows allows writing new .exe
Remove-Item target\release\shopee-server.old.exe -Force -ErrorAction SilentlyContinue
if (Test-Path target\release\shopee-server.exe) {
  Move-Item target\release\shopee-server.exe target\release\shopee-server.old.exe -Force -ErrorAction SilentlyContinue
}

# 3. Build Stripped Standalone Rust Release Binary
cargo build --release

# 4. Copy to StoreExplorer.exe (renaming running StoreExplorer.exe if active)
Remove-Item StoreExplorer.old.exe -Force -ErrorAction SilentlyContinue
if (Test-Path StoreExplorer.exe) {
  Move-Item StoreExplorer.exe StoreExplorer.old.exe -Force -ErrorAction SilentlyContinue
}
Copy-Item target\release\shopee-server.exe StoreExplorer.exe -Force
Write-Host "Build Complete -> StoreExplorer.exe"

# Actualizaciones De Desktop

Este proyecto ya tiene un menu de `Actualizaciones` conectado al updater de Tauri.

## Flujo esperado

1. Cambia la version en `src/lib/constants.ts`.
2. Genera el build firmado con `npm run tauri:build`.
3. Sube los artefactos generados a `GitHub Releases` del repo `DarkFlams/elbarato`.
4. La app instalada consulta `latest.json` y descarga la nueva version desde ahi.

Los artefactos que debes subir son:

```text
src-tauri\target\release\bundle\nsis\POS Tienda de Ropa_<version>_x64-setup.exe
src-tauri\target\release\bundle\nsis\POS Tienda de Ropa_<version>_x64-setup.exe.sig
src-tauri\target\release\bundle\nsis\latest.json
```

## Clave de firma

La firma se genera una sola vez con llave y password local:

```powershell
$password = ([guid]::NewGuid().ToString('N') + '!ElBarato')
Set-Content -Path "$env:USERPROFILE\.tauri\elbarato.pass.txt" -Value $password -NoNewline
npx tauri signer generate --ci -f -p $password -w $env:USERPROFILE\.tauri\elbarato.key
```

La llave privada queda en:

```text
C:\Users\migue\.tauri\elbarato.key
```

La password local queda en:

```text
C:\Users\migue\.tauri\elbarato.pass.txt
```

No se debe subir ni la llave ni la password al repositorio.

## Build de releases

El script `npm run tauri:build` ya usa la llave y password local en:

```text
C:\Users\migue\.tauri\elbarato.key
C:\Users\migue\.tauri\elbarato.pass.txt
```

Si quieres usar otra ruta, ajusta [tauri-build.ps1](c:\Users\migue\OneDrive\Escritorio\SoftwarePOS\scripts\tauri-build.ps1).

## Publicar a GitHub Releases

Ya existe un script para crear o actualizar la release y subir los assets correctos:

```powershell
npm run tauri:publish
```

Ese script usa:

- repo: `DarkFlams/elbarato`
- tag: `v<version>`
- assets:
  - `POS Tienda de Ropa_<version>_x64-setup.exe`
  - `POS Tienda de Ropa_<version>_x64-setup.exe.sig`
  - `latest.json`

Requiere un token de GitHub en una de estas variables:

```powershell
$env:GITHUB_TOKEN = "tu_token"
```

o

```powershell
$env:GH_TOKEN = "tu_token"
```

Si quieres recompilar y publicar en un solo paso:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\publish-github-release.ps1 -Build
```

Si quieres incluir notas de version:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\publish-github-release.ps1 -NotesFile .\docs\release-notes.md
```

## Endpoint de updater

El updater apunta a:

```text
https://github.com/DarkFlams/elbarato/releases/latest/download/latest.json
```

Ese archivo ya no lo genera Tauri automaticamente. Lo crea el script [generate-updater-assets.ps1](c:\Users\migue\OneDrive\Escritorio\SoftwarePOS\scripts\generate-updater-assets.ps1) despues del build.

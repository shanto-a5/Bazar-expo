$ErrorActionPreference = 'Stop'
$root = 'C:\Users\Kader\Desktop\vanta'
function Patch([string]$rel, [string]$needle, [string]$replacer, [string]$label) {
  $p = Join-Path $root $rel
  $t = [IO.File]::ReadAllText($p)
  if ($t.Contains($needle)) {
    $t = $t.Replace($needle, $replacer)
    [IO.File]::WriteAllText($p, $t)
    Write-Output ("PATCHED :: " + $label)
  } else {
    Write-Output ("NOCHANGE :: " + $label + "  [needle not on disk]")
  }
}
function PatchRegex([string]$rel, [string]$pattern, [string]$replacer, [string]$label) {
  $p = Join-Path $root $rel
  $t = [IO.File]::ReadAllText($p)
  $n = [regex]::Replace($t, $pattern, $replacer)
  if ($n -ne $t) {
    [IO.File]::WriteAllText($p, $n)
    Write-Output ("PATCHED :: " + $label)
  } else {
    Write-Output ("NOCHANGE :: " + $label)
  }
}
function EnsureImport([string]$rel, [string]$needle, [string]$anchor, [string]$importLine, [string]$label) {
  $p = Join-Path $root $rel
  $t = [IO.File]::ReadAllText($p)
  if (-not $t.Contains($needle)) {
    $t = $t.Replace($anchor, $anchor + "`n" + $importLine)
    [IO.File]::WriteAllText($p, $t)
    Write-Output ("PATCHED :: " + $label)
  } else {
    Write-Output ("NOCHANGE :: " + $label)
  }
}

# ---- login.tsx ----
EnsureImport 'src\app\(auth)\login.tsx' "import { Text } from 'react-native';" "import * as React from 'react';" "import { Text } from 'react-native';" "login :: Text import"
PatchRegex 'src\app\(auth)\login.tsx' '<h2' '<Text' "login :: h2 open"
PatchRegex 'src\app\(auth)\login.tsx' '</h2>' '</Text>' "login :: h2 close"
PatchRegex 'src\app\(auth)\login.tsx' '<h3' '<Text' "login :: h3 open"
PatchRegex 'src\app\(auth)\login.tsx' '</h3>' '</Text>' "login :: h3 close"
PatchRegex 'src\app\(auth)\login.tsx' '<h4' '<Text' "login :: h4 open"
PatchRegex 'src\app\(auth)\login.tsx' '</h4>' '</Text>' "login :: h4 close"
# style arrays -> single objects (RN <Text> accepts TextStyle[]; but avoid CSS Properties mismatch)
PatchRegex 'src\app\(auth)\login.tsx' 'style=\{\[type\.h([234]), (\{[^{}]*\})\]\}' 'style={{ ...type.h$1, $2 }}' "login :: style arrays -> objects"
# h4 token does not exist -> h3
PatchRegex 'src\app\(auth)\login.tsx' 'type\.h4' 'type.h3' "login :: h4 token -> h3"

# ---- register.tsx ----
EnsureImport 'src\app\(auth)\register.tsx' "import { Text } from 'react-native';" "import * as React from 'react';" "import { Text } from 'react-native';" "register :: Text import"
PatchRegex 'src\app\(auth)\register.tsx' '<h2' '<Text' "register :: h2 open"
PatchRegex 'src\app\(auth)\register.tsx' '</h2>' '</Text>' "register :: h2 close"
PatchRegex 'src\app\(auth)\register.tsx' '<h3' '<Text' "register :: h3 open"
PatchRegex 'src\app\(auth)\register.tsx' '</h3>' '</Text>' "register :: h3 close"
PatchRegex 'src\app\(auth)\register.tsx' '<h4' '<Text' "register :: h4 open"
PatchRegex 'src\app\(auth)\register.tsx' '</h4>' '</Text>' "register :: h4 close"
PatchRegex 'src\app\(auth)\register.tsx' 'style=\{\[type\.h([234]), (\{[^{}]*\})\]\}' 'style={{ ...type.h$1, $2 }}' "register :: style arrays -> objects"
PatchRegex 'src\app\(auth)\register.tsx' 'type\.h4' 'type.h3' "register :: h4 token -> h3"

# ---- forgot-password.tsx ----
EnsureImport 'src\app\(auth)\forgot-password.tsx' "import { Text } from 'react-native';" "import * as React from 'react';" "import { Text } from 'react-native';" "forgot :: Text import"
PatchRegex 'src\app\(auth)\forgot-password.tsx' '<h2' '<Text' "forgot :: h2 open"
PatchRegex 'src\app\(auth)\forgot-password.tsx' '</h2>' '</Text>' "forgot :: h2 close"
PatchRegex 'src\app\(auth)\forgot-password.tsx' '<h3' '<Text' "forgot :: h3 open"
PatchRegex 'src\app\(auth)\forgot-password.tsx' '</h3>' '</Text>' "forgot :: h3 close"
PatchRegex 'src\app\(auth)\forgot-password.tsx' '<h4' '<Text' "forgot :: h4 open"
PatchRegex 'src\app\(auth)\forgot-password.tsx' '</h4>' '</Text>' "forgot :: h4 close"
PatchRegex 'src\app\(auth)\forgot-password.tsx' 'style=\{\[type\.h([234]), (\{[^{}]*\})\]\}' 'style={{ ...type.h$1, $2 }}' "forgot :: style arrays -> objects"
PatchRegex 'src\app\(auth)\forgot-password.tsx' 'type\.h4' 'type.h3' "forgot :: h4 token -> h3"
# service API: emailExists -> Promise<boolean> (plain, not { exists })
Patch 'src\app\(auth)\forgot-password.tsx' 'const { exists } = await authService.emailExists(email.trim());' 'const exists = await authService.emailExists(email.trim());' "forgot :: emailExists boolean"
# no createRecoveryCode in AuthService -> local demo code
Patch 'src\app\(auth)\forgot-password.tsx' 'const recovery = await authService.createRecoveryCode(email.trim());' 'const recovery = { code: String(Math.floor(100000 + Math.random() * 900000)) };' "forgot :: local demo code (no invented API)"

Write-Output "DONE"
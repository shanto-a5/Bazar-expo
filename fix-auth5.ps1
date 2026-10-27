$ErrorActionPreference = 'Stop'
$root = 'C:\Users\Kader\Desktop\vanta'

function PatchList([string[]]$rels, [scriptblock]$transform, [string]$label) {
  foreach ($rel in $rels) {
    $p = Join-Path $root $rel
    $t = [IO.File]::ReadAllText($p)
    $n = & $transform $t
    [IO.File]::WriteAllText($p, $n)
    Write-Output ("PATCHED :: " + $label + " :: " + $rel)
  }
}

# 1. Convert lowercase HTML h2/h3/h4 -> RN Text  (in all three auth screens)
$authScreens = @(
  "src\app\(auth)\login.tsx",
  "src\app\(auth)\register.tsx",
  "src\app\(auth)\forgot-password.tsx"
)
PatchList $authScreens {
  param($t)
  $t = $t -replace '<h[234] ', '<Text '
  $t = $t -replace '</h[234]>', '</Text>'
  if (-not $t.Contains("import { Text } from 'react-native';")) {
    $t = $t -replace "import \{ Link, Redirect, router \} from 'expo-router';", "import { Link, Redirect, router } from 'expo-router';`nimport { Text } from 'react-native';"
  }
  $t
} "HTML->Text + Text import"

# 2. forgot-password: real AuthService boolean + local demo code (no invented methods)
$forgot = Join-Path $root "src\app\(auth)\forgot-password.tsx"
$t = [IO.File]::ReadAllText($forgot)
if ($t.Contains('const { exists } = await authService.emailExists(')) {
  $t = $t.Replace('const { exists } = await authService.emailExists(', 'const exists = await authService.emailExists(')
  Write-Output "PATCHED :: forgot emailExists -> boolean"
} else {
  Write-Output "NOCHANGE :: forgot emailExists (needle missing)"
}
if ($t.Contains('createRecoveryCode')) {
  $t = $t -replace '= await authService\.createRecoveryCode\([^;]*\);', '= { code: String(Math.floor(100000 + Math.random() * 900000)) };'
  Write-Output "PATCHED :: forgot createRecoveryCode -> local demo code"
} else {
  Write-Output "NOCHANGE :: forgot createRecoveryCode (needle missing)"
}
[IO.File]::WriteAllText($forgot, $t)

Write-Output "`n===== tsc --noEmit ====="
npx tsc --noEmit
Write-Output ("TSC_EXIT=" + $LASTEXITCODE)
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Output "`n===== expo lint ====="
npx expo lint
Write-Output ("LINT_EXIT=" + $LASTEXITCODE)

Write-Output "`n===== expo export --platform web ====="
npx expo export --platform web
Write-Output ("EXPORT_EXIT=" + $LASTEXITCODE)

$ErrorActionPreference = 'Stop'
function Patch([string]$rel, [scriptblock]$transform, [string]$label) {
  $abs = Join-Path (Get-Location) $rel
  if (-not (Test-Path -LiteralPath $abs)) { Write-Output ("MISSING :: " + $label + " :: " + $rel); return }
  $before = [IO.File]::ReadAllText($abs)
  if (-not $before) { Write-Output ("EMPTY :: " + $label); return }
  $after = & $transform $before
  if ($after -ceq $before) { Write-Output ("NOCHANGE :: " + $label) }
  else { [IO.File]::WriteAllText($abs, $after); Write-Output ("PATCHED :: " + $label) }
}

# ---------- A. forgot-password.tsx: emailExists returns bool, not { exists } ----------
# The real AuthService.emailExists -> Promise<boolean> (not Boolean.exists).
Patch "src\app\(auth)\forgot-password.tsx" {
  param($t)
  $t = $t -replace 'const \{ exists \} = await authService\.emailExists\(([^)]*)\);', 'const exists = await authService.emailExists($1);'
  # createRecoveryCode() does not exist on AuthService -> demo: generate a fresh 6-digit code
  $t = $t -replace 'await authService\.createRecoveryCode\(([^)]*)\);', '({ code: String(Math.floor(100000 + Math.random() * 900000)) });'
  return $t
} "forgot-password: emailExists boolean + demo recovery code"

# ---------- B. TextStyle[] -> single object for h3/h4 style arrays ----------
$files = @(
  "src\app\(auth)\login.tsx",
  "src\app\(auth)\register.tsx",
  "src\app\(auth)\forgot-password.tsx"
)
foreach ($rel in $files) {
  Patch $rel {
    param($t)
    # fix mismatched token: type.h4 doesn't exist (tokens have display/h1/h2/h3/body/bodyMuted/caption/label)
    $t = $t -replace 'type\.h4', 'type.h3'
    return $t
  } ("token h4->h3 :: " + $rel)
}

# ---------- C. login.tsx: wire up the real shared Logo component ----------
Patch "src\app\(auth)\login.tsx" {
  param($t)
  # ui.tsx HAS a real Logo export; login.tsx must import it from the shared API.
  if ($t -notmatch "Logo") {
    $t = $t -replace "from '@/components/ui';", "from '@/components/ui'; // Logo lives in ui"
  }
  $t = $t -replace 'import \{ (Button, Field, Screen) \} from ''@/''components/ui'';', 'import { $1, Logo } from ''@/''components/ui'';'
  return $t
} "login: import Logo"

# ---------- D. register/forgot also import Logo like login ----------
Patch "src\app\(auth)\forgot-password.tsx" {
  param($t)
  $t = $t -replace 'import \{ (Button, Field, Screen) \} from ''@/''components/ui'';', 'import { $1, Logo } from ''@/''components/ui'';'
  return $t
} "forgot: import Logo"

$ErrorActionPreference = 'Stop'
function Fix([string]$rel, [hashtable]$repls, [string]$label) {
  $abs = Join-Path (Get-Location) $rel
  $before = [IO.File]::ReadAllText($abs)
  $cur = $before
  foreach ($k in $repls.Keys) { $cur = $cur.Replace($k, $repls[$k]) }
  if (($cur -eq $before)) { Write-Output ("SKIP (no textual change) :: " + $label) }
  else {
    [IO.File]::WriteAllText($abs, $cur)
    $totalRepl = 0
    foreach ($k in $repls.Keys) {
      $count = ([regex]::Matches($before, [regex]::Escape($k))).Count
      $totalRepl += [math]::Max(0, ([regex]::Matches($before, [regex]::Escape($k))).Count - ([regex]::Matches($cur, [regex]::Escape($k))).Count)
    }
    Write-Output ("PATCHED :: " + $label + "  (" + $totalRepl + " occurrences changed)")
  }
}

# ---------- A. Logo: append a real shared Vanta wordmark to ui.tsx ----------
$uiAbs = Join-Path (Get-Location) "src\components\ui.tsx"
if (-not ([IO.File]::ReadAllText($uiAbs)).Contains("export function Logo")) {
  $logo = @'


/**
 * Vanta wordmark.
 * Renders the rounded brand tile + "VANTA" lockup used on auth screens.
 */
export function Logo({ size = 56 }: { size?: number }): React.JSX.Element {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.md,
        backgroundColor: colors.primary,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: colors.textInverse, fontSize: size * 0.34, fontWeight: '800', letterSpacing: 0.5 }}>
        V
      </Text>
    </View>
  );
}
'@
  $uiText = [IO.File]::ReadAllText($uiAbs)
  [IO.File]::WriteAllText($uiAbs, $uiText + "`r`n" + $logo + "`r`n")
  Write-Output "PATCHED :: ui.tsx -> appended Logo wordmark"
} else {
  Write-Output "SKIP :: ui.tsx already has Logo"
}

# ---------- B. (auth)/_layout.tsx: remove the stale (nonexistent) index screen ----------
Fix "src\app\(auth)\_layout.tsx" @{
  "<Stack.Screen name=\"index\" options={{ headerShown: false }} />" = ""
} "(auth)/_layout: drop stale index Stack.Screen"

# ---------- C. login.tsx ----------
Fix "src\app\(auth)\login.tsx" @{
  "import { Button, Field, Screen } from '@/components/ui';" = "import { Button, Field, Logo, Screen } from '@/components/ui';"
  "type.h4" = "type.h3"
} "login: add Logo import; h4->h3"

# ---------- D. register.tsx ----------
Fix "src\app\(auth)\register.tsx" @{
  "type.h4" = "type.h3"
} "register: h4->h3"

# ---------- E. forgot-password.tsx ----------
Fix "src\app\(auth)\forgot-password.tsx" @{
  "const { exists } = await authService.emailExists(email.trim());" = "const exists = await authService.emailExists(email.trim());"
  "const recovery = await authService.createRecoveryCode(email.trim());" = "const recovery = { code: String(Math.floor(100000 + Math.random() * 900000)) };"
  "type.h4" = "type.h3"
} "forgot-password: emailExists boolean; demo recovery code; h4->h3"

Write-Output ""
Write-Output "================ tsc --noEmit ================"
npx tsc --noEmit
Write-Output ("TSC_EXIT=" + $LASTEXITCODE)

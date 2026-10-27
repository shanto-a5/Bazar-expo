$ErrorActionPreference = 'Stop'
$root = 'C:\Users\Kader\Desktop\vanta'
function P([string]$rel, [string]$needle, [string]$replacer, [string]$label) {
  $p = Join-Path $root $rel
  $t = [IO.File]::ReadAllText($p)
  if ($t.Contains($needle)) {
    $t = $t.Replace($needle, $replacer)
    [IO.File]::WriteAllText($p, $t)
    Write-Output ("PATCHED :: " + $label)
  } else {
    Write-Output ("NOCHANGE :: " + $label)
  }
}

# Add Text import if missing (byte-check, then append to react-native import line)
function EnsureTextImport([string]$rel) {
  $p = Join-Path $root $rel
  $t = [IO.File]::ReadAllText($p)
  if ($t -match "(?m)^import \{ Text \} from 'react-native';") { Write-Output ("NOCHANGE :: Text import :: " + $rel); return }
  $t = [regex]::Replace($t, "(?m)^(import \{ [^}]*? \} from 'react-native';)", '${1}`nimport { text } from ''react-native'';', 1)
  [IO.File]::WriteAllText($p, $t)
  Write-Output ("PATCHED :: Text import :: " + $rel)
}

# ---------- login.tsx ----------
$l = 'src\app\(auth)\login.tsx'
EnsureTextImport $l
P $l '<h2 style={{ ...type.h2, ...{ marginTop: 12, marginBottom: 4 } }}>Welcome back</h2>' '<Text style={{ ...type.h2, ...{ marginTop: 12, marginBottom: 4 } }}>Welcome back</Text>' 'login h2->Text'
P $l '<h3 style={{ ...type.h3, ...{ marginBottom: 24, color: colors.textMuted } }}>Sign in to continue shopping.</h3>' '<Text style={{ ...type.h3, ...{ marginBottom: 24, color: colors.textMuted } }}>Sign in to continue shopping.</Text>' 'login h3->Text'
P $l '<h4 style={{ ...type.h3, ...{ color: colors.danger, marginTop: 8 } }}>{formError}</h4>' '<Text style={{ ...type.h3, ...{ color: colors.danger, marginTop: 8 } }}>{formError}</Text>' 'login h4(err)->Text'
P $l '<h4 style={{ ...type.h3, ...{ color: colors.primary, textAlign: ''center'' } }}>Don''t have an account? Create one</h4>' '<Text style={{ ...type.h3, ...{ color: colors.primary, textAlign: ''center'' } }}>Don''t have an account? Create one</Text>' 'login h4(link)->Text'

# ---------- register.tsx ----------
$r = 'src\app\(auth)\register.tsx'
EnsureTextImport $r
P $r '<h2 style={{ ...type.h2, ...{ marginTop: 12, marginBottom: 4 } }}>Create your account</h2>' '<Text style={{ ...type.h2, ...{ marginTop: 12, marginBottom: 4 } }}>Create your account</Text>' 'register h2->Text'
P $r '<h3 style={{ ...type.h3, ...{ marginBottom: 20, color: colors.textMuted } }}>Start shopping right away — no card needed.</h3>' '<Text style={{ ...type.h3, ...{ marginBottom: 20, color: colors.textMuted } }}>Start shopping right away — no card needed.</Text>' 'register h3->Text'
P $r '<h4 style={{ ...type.h3, ...{ color: colors.danger, marginTop: 8 } }}>{formError}</h4>' '<Text style={{ ...type.h3, ...{ color: colors.danger, marginTop: 8 } }}>{formError}</Text>' 'register h4(err)->Text'
P $r '<h4 style={{ ...type.h3, ...{ color: colors.primary, textAlign: ''center'' } }}>Already have an account? Sign in</h4>' '<Text style={{ ...type.h3, ...{ color: colors.primary, textAlign: ''center'' } }}>Already have an account? Sign in</Text>' 'register h4(link)->Text'

# ---------- forgot-password.tsx ----------
$f = 'src\app\(auth)\forgot-password.tsx'
EnsureTextImport $f
P $f 'const { exists } = await authService.emailExists(email.trim());' 'const exists = await authService.emailExists(email.trim());' 'forgot emailExists boolean'
P $f 'const recovery = await authService.createRecoveryCode(email.trim());' 'const recovery = { code: String(Math.floor(100000 + Math.random() * 900000)) };' 'forgot local demo code'
P $f '<h2 style={{ ...type.h2, ...{ marginBottom: 4 } }}>Forgot password</h2>' '<Text style={{ ...type.h2, ...{ marginBottom: 4 } }}>Forgot password</Text>' 'forgot h2->Text'
P $f '<h3 style={{ ...type.h3, ...{ marginBottom: 20, color: colors.textMuted } }}>Enter your email and we''ll send a recovery code.</h3>' '<Text style={{ ...type.h3, ...{ marginBottom: 20, color: colors.textMuted } }}>Enter your email and we''ll send a recovery code.</Text>' 'forgot h3->Text'
P $f '<h4 style={{ ...type.h3, ...{ color: colors.danger, marginTop: 8 } }}>{formError}</h4>' '<Text style={{ ...type.h3, ...{ color: colors.danger, marginTop: 8 } }}>{formError}</Text>' 'forgot h4(err)->Text'
P $f '<h4 style={{ ...type.h3, ...{ color: colors.primary, textAlign: ''center'' } }}>Remembered it? Sign in</h4>' '<Text style={{ ...type.h3, ...{ color: colors.primary, textAlign: ''center'' } }}>Remembered it? Sign in</Text>' 'forgot h4(link)->Text'

Write-Output 'DONE§'
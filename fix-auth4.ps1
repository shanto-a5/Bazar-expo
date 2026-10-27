$ErrorActionPreference = 'Stop'
$root = 'C:\Users\Kader\Desktop\vanta'

function PatchText([string]$rel, [string]$needle, [string]$replacer, [string]$label) {
  $p = Join-Path $root $rel
  $t = [IO.File]::ReadAllText($p)
  if ($t.Contains($needle)) {
    [IO.File]::WriteAllText($p, $t.Replace($needle, $replacer))
    Write-Output ("PATCHED :: " + $label)
  } else {
    Write-Output ("NOCHANGE :: " + $label)
  }
}

# 1. ui.tsx: import Image from react-native (Logo needs it)
PatchText 'src\components\ui.tsx' '  TextInput,
  View,' '  TextInput,
  Image,
  View,' "ui.tsx Image import"

# 2-4. Auth screens: bring in RN Text so <Text style={...array}> typechecks
foreach ($f in @('login','register','forgot-password')) {
  $rel = "src\app\(auth)\$f.tsx"
  PatchText $rel "import * as React from 'react';" "import * as React from 'react';

import { Text } from 'react-native';" "$f.tsx Text import"
}

$all = @(
  'src\app\(auth)\login.tsx',
  'src\app\(auth)\register.tsx',
  'src\app\(auth)\forgot-password.tsx'
)
foreach ($rel in $all) {
  $p = Join-Path $root $rel
  $t = [IO.File]::ReadAllText($p)
  # convert style arrays on our styled elements back to single-object spreads:
  #   style={[type.h3, { ... }]}  ->  style={{ ...type.h3, ...{ ... } }}
  $t = $t -replace 'style=\{\[(type\.h[123]), (\{[^{}]*\})\]\}', 'style={{ ...$1, ...$2 }}'
  [IO.File]::WriteAllText($p, $t)
  Write-Output ("ARRAYFIX :: " + $rel)
}

Write-Output "DONE"

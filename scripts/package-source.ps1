param()
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$outputDir = Join-Path $projectRoot 'dist'
$archivePath = Join-Path $outputDir 'Hongson-Plan-source.zip'

# Include source files explicitly so local data, credentials, and binaries stay local.
$relativePaths = @(
    '.gitignore', 'README.md', 'REQUIREMENTS.md', 'IMPLEMENTATION_PLAN.md',
    'API_CONTRACT.md', 'package.json', 'server.mjs',
    'Start-Hongson.cmd', 'Start-Hongson.ps1',
    'Start-Hongson-Share.cmd', 'Start-Hongson-Share.ps1',
    'Stop-Hongson-Share.cmd', 'Stop-Hongson-Share.ps1',
    'public/index.html', 'public/app.js', 'public/style.css',
    'public/project-template.js', 'public/reference-picker.js',
    'public/school-reference-data.example.json',
    'src/database.mjs', 'src/domain.mjs', 'src/project-references.mjs',
    'scripts/share-gateway.mjs', 'scripts/share-runner.mjs',
    'scripts/extract_references.py', 'scripts/package-source.ps1'
)
$testRoot = Join-Path $projectRoot 'tests'
$relativePaths += Get-ChildItem -LiteralPath $testRoot -Recurse -File |
    Where-Object { $_.Extension -in @('.mjs', '.json') } |
    ForEach-Object { $_.FullName.Substring($projectRoot.Length + 1).Replace('\', '/') }
$relativePaths = @($relativePaths | Sort-Object -Unique)
foreach ($relativePath in $relativePaths) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $relativePath) -PathType Leaf)) {
        throw "Missing source file: $relativePath"
    }
}

New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stream = [System.IO.File]::Open($archivePath, [System.IO.FileMode]::Create)
try {
    $zip = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($relativePath in $relativePaths) {
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $zip, (Join-Path $projectRoot $relativePath), $relativePath,
                [System.IO.Compression.CompressionLevel]::Optimal
            ) | Out-Null
        }
    } finally {
        $zip.Dispose()
    }
} finally {
    $stream.Dispose()
}
Write-Output "Created: $archivePath"
Write-Output "Source files: $($relativePaths.Count)"

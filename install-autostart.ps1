# Creates a shortcut in the Windows Startup folder so the local agent
# (server.py) starts hidden at login. Run again after moving the folder.
# Remove: delete "Home Agent.lnk" from shell:startup.

$here = Split-Path -Parent $MyInvocation.MyCommand.Path

# Find pythonw.exe: python.org installs register it (newest version first),
# then PATH, then whatever `python` / `py` runs, then the default install folder.
function Find-Pythonw {
    $keys = Get-ChildItem 'HKCU:\Software\Python\PythonCore', 'HKLM:\Software\Python\PythonCore' -ErrorAction SilentlyContinue |
        Sort-Object { try { [version]($_.PSChildName -replace '[^0-9.]', '') } catch { [version]'0.0' } } -Descending
    foreach ($k in $keys) {
        $ip = Get-ItemProperty (Join-Path $k.PSPath 'InstallPath') -ErrorAction SilentlyContinue
        if (-not $ip) { continue }
        $candidates = @($ip.WindowedExecutablePath)
        if ($ip.'(default)') { $candidates += (Join-Path $ip.'(default)' 'pythonw.exe') }
        foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
    }
    $cmd = Get-Command pythonw.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($launcher in @('python', 'py')) {
        if (-not (Get-Command $launcher -ErrorAction SilentlyContinue)) { continue }
        $exe = & $launcher -c "import sys; print(sys.executable)" 2>$null
        if ($exe) {
            $candidate = Join-Path (Split-Path $exe.Trim()) 'pythonw.exe'
            if (Test-Path $candidate) { return $candidate }
        }
    }
    $default = Get-ChildItem "$env:LOCALAPPDATA\Programs\Python\Python3*\pythonw.exe" -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending | Select-Object -First 1
    if ($default) { return $default.FullName }
    return $null
}

$pythonw = Find-Pythonw
if (-not $pythonw) {
    Write-Error "No se encontró pythonw.exe. Instala Python desde python.org o añade su carpeta al PATH."
    exit 1
}

$lnkPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'Home Agent.lnk'
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($lnkPath)
$lnk.TargetPath       = $pythonw
$lnk.Arguments        = '"' + (Join-Path $here 'server.py') + '"'
$lnk.WorkingDirectory = $here
$lnk.Description      = 'Home / System 01 local agent (http://127.0.0.1:47800)'
$lnk.Save()
Write-Output "Autostart creado: $lnkPath"
Write-Output "Python: $pythonw"

# Start it now too, unless an agent is already answering.
$running = $false
try { $running = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:47800/api/stats').StatusCode -eq 200 } catch {}
if ($running) {
    Write-Output "El agente ya estaba en marcha en http://127.0.0.1:47800"
} else {
    Start-Process -FilePath $pythonw -ArgumentList $lnk.Arguments -WorkingDirectory $here -WindowStyle Hidden
    Write-Output "Agente arrancado en http://127.0.0.1:47800"
}

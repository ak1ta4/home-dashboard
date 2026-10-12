# Registers a per-user scheduled task "Home Agent" that starts the local agent
# (server.py, hidden) when you sign in to Windows. No admin rights needed.
# Run again after moving the folder.
# Remove:  Unregister-ScheduledTask -TaskName 'Home Agent' -Confirm:$false

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$taskName = 'Home Agent'

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

# Older versions used a Startup-folder shortcut; remove it so there's one launcher only.
$oldLnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Home Agent.lnk'
if (Test-Path $oldLnk) { Remove-Item $oldLnk -Force; Write-Output "Acceso directo antiguo eliminado: $oldLnk" }

$user = "$env:USERDOMAIN\$env:USERNAME"
$action = New-ScheduledTaskAction -Execute $pythonw -Argument ('"' + (Join-Path $here 'server.py') + '"') -WorkingDirectory $here
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$trigger.Delay = 'PT15S'  # let Windows finish signing in first
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
    -Description 'Home / System 01 local agent (http://127.0.0.1:47800)' -Force | Out-Null
Write-Output "Tarea programada creada: '$taskName' (al iniciar sesión)"
Write-Output "Python: $pythonw"

# Start it now too, unless an agent is already answering.
$running = $false
try { $running = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:47800/api/stats').StatusCode -eq 200 } catch {}
if ($running) {
    Write-Output "El agente ya estaba en marcha en http://127.0.0.1:47800"
} else {
    Start-ScheduledTask -TaskName $taskName
    Write-Output "Agente arrancado en http://127.0.0.1:47800"
}

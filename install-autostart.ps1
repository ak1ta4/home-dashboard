# Creates a shortcut in the Windows Startup folder so the local agent
# (server.py) starts hidden at login. Run again after moving the folder.
# Remove: delete "Home Agent.lnk" from shell:startup.

$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonw = (Get-Command pythonw.exe -ErrorAction Stop).Source
$lnkPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'Home Agent.lnk'

$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($lnkPath)
$lnk.TargetPath       = $pythonw
$lnk.Arguments        = '"' + (Join-Path $here 'server.py') + '"'
$lnk.WorkingDirectory = $here
$lnk.Description      = 'Home / System 01 local agent (http://127.0.0.1:47800)'
$lnk.Save()

Start-Process -FilePath $pythonw -ArgumentList $lnk.Arguments -WorkingDirectory $here -WindowStyle Hidden
Write-Output "Autostart creado: $lnkPath"
Write-Output "Agente arrancado en http://127.0.0.1:47800"

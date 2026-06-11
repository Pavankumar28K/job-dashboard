Set oWS = WScript.CreateObject("WScript.Shell")
sLinkFile = oWS.SpecialFolders("Desktop") & "\Job Dashboard.lnk"
Set oLink = oWS.CreateShortcut(sLinkFile)
oLink.TargetPath = "C:\Users\konat\job-dashboard\START_APP.bat"
oLink.WorkingDirectory = "C:\Users\konat\job-dashboard"
oLink.Description = "Start Job Dashboard"
oLink.IconLocation = "C:\Windows\System32\cmd.exe,0"
oLink.Save
WScript.Echo "Shortcut created on Desktop"

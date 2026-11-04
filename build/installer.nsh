; Custom NSIS macros for the Breakmine Desktop Windows installer.
;
; Registers breakmine-game:// with the installer so mod-wiki download links
; reach the game. electron-builder has no built-in option for custom URL
; schemes, so the registry keys are written here instead.
;
; The Linux AppImage gets the same effect from the MimeType line in
; electron-builder.yml; Windows has no equivalent, hence this file.
;
; SHCTX follows electron-builder: HKCU for a per-user install, HKLM when the
; user chose a machine-wide one, so the keys always land where the installer
; actually wrote the files.

!macro customInstall
  WriteRegStr SHCTX "Software\Classes\breakmine-game" "" "URL:Breakmine Desktop"
  WriteRegStr SHCTX "Software\Classes\breakmine-game" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\breakmine-game\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"

  ; %1 is the full deep link. main.js scans process.argv for it and routes
  ; it through the 'install' action.
  WriteRegStr SHCTX "Software\Classes\breakmine-game\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\Classes\breakmine-game"
!macroend
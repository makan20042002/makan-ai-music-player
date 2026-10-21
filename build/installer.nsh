; MAKAN AI Music Player - Windows Explorer integration (added to the installer by electron-builder: nsis.include)
;
;  * "Open with" for mp3, flac, wav, m4a, aac, ogg, opus (and the entry in Windows Settings -> Default apps)
;  * right-click a song or a folder -> "Play with MAKAN AI Music Player"
;  * the whole selection is given to the app, even thousands of files: a DropTarget helper (makan-open.dll)
;    receives it from Explorer, like Windows Media Player does, and starts the app with --open-list <file>
; Written for the current user only (HKCU). Windows does not let an app make itself the default player:
; use right-click -> Open with -> Choose another app -> MAKAN -> Always, once.

!define MAKAN_CLSID "{7C1B5E2A-3F4D-4A8B-9E21-6D0A5B7C9F13}"
!define MAKAN_PROGID "MAKAN.Audio"
!define MAKAN_VERB "Play with MAKAN AI Music Player"

!macro MAKAN_ASSOC EXT
  WriteRegStr HKCU "Software\Classes\${EXT}\OpenWithProgids" "${MAKAN_PROGID}" ""
  WriteRegStr HKCU "Software\MAKAN\MusicPlayer\Capabilities\FileAssociations" "${EXT}" "${MAKAN_PROGID}"
!macroend

!macro MAKAN_UNASSOC EXT
  DeleteRegValue HKCU "Software\Classes\${EXT}\OpenWithProgids" "${MAKAN_PROGID}"
!macroend

!macro customInstall
  ; where the app is (the helper reads this)
  WriteRegStr HKCU "Software\MAKAN\MusicPlayer" "ExePath" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"

  ; the helper (a small COM DLL that receives the whole selection)
  WriteRegStr HKCU "Software\Classes\CLSID\${MAKAN_CLSID}" "" "MAKAN open helper"
  WriteRegStr HKCU "Software\Classes\CLSID\${MAKAN_CLSID}\InprocServer32" "" "$INSTDIR\resources\app.asar.unpacked\desktop\bin\makan-open.dll"
  WriteRegStr HKCU "Software\Classes\CLSID\${MAKAN_CLSID}\InprocServer32" "ThreadingModel" "Apartment"

  ; the file type entry
  WriteRegStr HKCU "Software\Classes\${MAKAN_PROGID}" "" "Audio file (MAKAN AI Music Player)"
  WriteRegStr HKCU "Software\Classes\${MAKAN_PROGID}\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Classes\${MAKAN_PROGID}\shell" "" "open"
  WriteRegStr HKCU "Software\Classes\${MAKAN_PROGID}\shell\open" "MUIVerb" "${MAKAN_VERB}"
  WriteRegStr HKCU "Software\Classes\${MAKAN_PROGID}\shell\open" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Classes\${MAKAN_PROGID}\shell\open" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\${MAKAN_PROGID}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr HKCU "Software\Classes\${MAKAN_PROGID}\shell\open\DropTarget" "Clsid" "${MAKAN_CLSID}"

  ; right-click a folder -> Play with MAKAN
  WriteRegStr HKCU "Software\Classes\Directory\shell\MAKANPlay" "MUIVerb" "${MAKAN_VERB}"
  WriteRegStr HKCU "Software\Classes\Directory\shell\MAKANPlay" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Classes\Directory\shell\MAKANPlay" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\Directory\shell\MAKANPlay\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr HKCU "Software\Classes\Directory\shell\MAKANPlay\DropTarget" "Clsid" "${MAKAN_CLSID}"

  ; Windows Settings -> Default apps
  WriteRegStr HKCU "Software\MAKAN\MusicPlayer\Capabilities" "ApplicationName" "MAKAN AI Music Player"
  WriteRegStr HKCU "Software\MAKAN\MusicPlayer\Capabilities" "ApplicationDescription" "Music player with lyrics, translation and sound tools"
  WriteRegStr HKCU "Software\RegisteredApplications" "MAKAN AI Music Player" "Software\MAKAN\MusicPlayer\Capabilities"

  !insertmacro MAKAN_ASSOC ".mp3"
  !insertmacro MAKAN_ASSOC ".flac"
  !insertmacro MAKAN_ASSOC ".wav"
  !insertmacro MAKAN_ASSOC ".m4a"
  !insertmacro MAKAN_ASSOC ".aac"
  !insertmacro MAKAN_ASSOC ".ogg"
  !insertmacro MAKAN_ASSOC ".opus"

  ; tell Explorer that file types changed
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\${MAKAN_PROGID}"
  DeleteRegKey HKCU "Software\Classes\CLSID\${MAKAN_CLSID}"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\MAKANPlay"
  DeleteRegValue HKCU "Software\RegisteredApplications" "MAKAN AI Music Player"
  DeleteRegKey HKCU "Software\MAKAN\MusicPlayer"
  DeleteRegKey /ifempty HKCU "Software\MAKAN"
  !insertmacro MAKAN_UNASSOC ".mp3"
  !insertmacro MAKAN_UNASSOC ".flac"
  !insertmacro MAKAN_UNASSOC ".wav"
  !insertmacro MAKAN_UNASSOC ".m4a"
  !insertmacro MAKAN_UNASSOC ".aac"
  !insertmacro MAKAN_UNASSOC ".ogg"
  !insertmacro MAKAN_UNASSOC ".opus"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

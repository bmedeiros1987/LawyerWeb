; LawyerMind aparece em "Abrir com" e em Configurações > Aplicativos padrão para PDF e DOCX.
; NÃO usamos "fileAssociations" do Tauri no Windows: o modelo dele chama APP_ASSOCIATE, que grava o
; valor padrão da extensão (.pdf/.docx) e tomaria o lugar do aplicativo atual do usuário.
; Aqui só se cadastra (HKCU, instalação por usuário):
;   - ProgIDs próprios (LawyerMind.PDF / LawyerMind.DOCX);
;   - o ProgID na lista "Abrir com" da extensão (OpenWithProgids), SEM tocar no valor padrão da extensão;
;   - Capabilities + RegisteredApplications, para o app constar na lista oficial de aplicativos padrão.
; A escolha do padrão é do usuário, pelo fluxo do Windows. UserChoice nunca é lido nem gravado.
; .doc (Word 97-2003) não é cadastrado.

!macro LM_REGISTER_TYPE EXT PROGID DESC
  WriteRegStr HKCU "Software\Classes\${PROGID}" "" "${DESC}"
  WriteRegStr HKCU "Software\Classes\${PROGID}\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "Software\Classes\${PROGID}\shell\open" "FriendlyAppName" "LawyerMind"
  WriteRegStr HKCU "Software\Classes\${PROGID}\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\.${EXT}\OpenWithProgids" "${PROGID}" ""
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".${EXT}" ""
  WriteRegStr HKCU "Software\LawyerMind\Capabilities\FileAssociations" ".${EXT}" "${PROGID}"
!macroend

!macro LM_UNREGISTER_TYPE EXT PROGID
  DeleteRegValue HKCU "Software\Classes\.${EXT}\OpenWithProgids" "${PROGID}"
  DeleteRegKey HKCU "Software\Classes\${PROGID}"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro LM_REGISTER_TYPE "pdf" "LawyerMind.PDF" "Documento PDF"
  !insertmacro LM_REGISTER_TYPE "docx" "LawyerMind.DOCX" "Documento Word (.docx)"
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "LawyerMind"
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  WriteRegStr HKCU "Software\LawyerMind\Capabilities" "ApplicationName" "LawyerMind"
  WriteRegStr HKCU "Software\LawyerMind\Capabilities" "ApplicationDescription" "Escritório local: abre PDF e DOCX como cópia, sem alterar o original."
  WriteRegStr HKCU "Software\RegisteredApplications" "LawyerMind" "Software\LawyerMind\Capabilities"
  ; Avisa o Explorer para reler as associações (SHCNE_ASSOCCHANGED).
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro LM_UNREGISTER_TYPE "pdf" "LawyerMind.PDF"
  !insertmacro LM_UNREGISTER_TYPE "docx" "LawyerMind.DOCX"
  DeleteRegKey HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  DeleteRegValue HKCU "Software\RegisteredApplications" "LawyerMind"
  DeleteRegKey HKCU "Software\LawyerMind\Capabilities"
  DeleteRegKey /ifempty HKCU "Software\LawyerMind"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

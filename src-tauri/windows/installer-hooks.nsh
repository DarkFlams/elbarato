!macro CleanupLegacyPosTiendaDeRopa
  SetShellVarContext current
  Delete "$DESKTOP\POS Tienda de Ropa.lnk"
  Delete "$SMPROGRAMS\POS Tienda de Ropa.lnk"
  Delete "$SMPROGRAMS\POS Tienda de Ropa\POS Tienda de Ropa.lnk"
  RMDir "$SMPROGRAMS\POS Tienda de Ropa"
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro CleanupLegacyPosTiendaDeRopa
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro CleanupLegacyPosTiendaDeRopa
  RMDir /r "$LOCALAPPDATA\Programs\POS Tienda de Ropa"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro CleanupLegacyPosTiendaDeRopa
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro CleanupLegacyPosTiendaDeRopa
!macroend

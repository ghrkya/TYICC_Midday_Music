; TYICC午间悦听制作器 - NSIS 自定义脚本
; 确保更新时保留 usrdata 目录（音乐库等用户数据）

!macro customUnInstall
  ; 卸载前把 usrdata 备份到临时目录，防止被误删
  IfFileExists "$INSTDIR\usrdata\*.*" 0 noUsrDataBackup
    CreateDirectory "$TEMP\tyicc_usrdata_bak"
    CopyFiles /SILENT "$INSTDIR\usrdata\*.*" "$TEMP\tyicc_usrdata_bak"
  noUsrDataBackup:
!macroend

!macro customInstall
  ; 安装完成后恢复 usrdata
  IfFileExists "$TEMP\tyicc_usrdata_bak\*.*" 0 noUsrDataRestore
    CreateDirectory "$INSTDIR\usrdata"
    CopyFiles /SILENT "$TEMP\tyicc_usrdata_bak\*.*" "$INSTDIR\usrdata"
    RMDir /r "$TEMP\tyicc_usrdata_bak"
  noUsrDataRestore:
!macroend

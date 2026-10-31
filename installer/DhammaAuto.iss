; ตัวติดตั้ง ธรรมะ Auto — สร้างด้วย: node scripts/build-installer.mjs (สร้างแพ็กเกจก่อนแล้วเรียก ISCC)
;
; ลูกค้าดับเบิลคลิก Setup.exe → ได้ครบ: โปรแกรม + node + ffmpeg + Python/เสียง Edge + ลงทะเบียนกับ Chrome
;   - ไม่มี Chrome → ดาวน์โหลดและติดตั้งให้
;   - ระบบเสียงในเครื่อง (F5-TTS / เทรนเสียง / Whisper) เป็นตัวเลือก โชว์เฉพาะเครื่องที่มีการ์ดจอ NVIDIA
; ติดตั้งแบบผู้ใช้คนเดียว (ไม่ต้องใช้สิทธิ์ admin) — โปรแกรมเขียนงานคลิปลงโฟลเดอร์ของตัวเองได้
; ขั้นเดียวที่ทำแทนไม่ได้: Load unpacked ใน Chrome (Chrome ไม่อนุญาต) — หน้าจบบอกวิธี และคัดลอกที่อยู่ไว้ให้แล้ว

#ifndef AppVer
  #define AppVer "1.0.0"
#endif
#define AppName "ธรรมะ Auto"
#define Src "..\dist\DhammaAuto"

[Setup]
AppId={{8C1B2E7A-5D3F-4F6B-9A21-DA11A5D0A001}
AppName={#AppName}
AppVersion={#AppVer}
AppVerName={#AppName} {#AppVer}
AppPublisher={#AppName}
DefaultDirName={userpf}\DhammaAuto
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=DhammaAuto-Setup-{#AppVer}
SetupIconFile=..\extension\icons\dhamma-auto.ico
UninstallDisplayIcon={app}\extension\icons\dhamma-auto.ico
UninstallDisplayName={#AppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
CloseApplications=no

[Languages]
Name: "thai"; MessagesFile: "compiler:Languages\Thai.isl"

[Messages]
thai.FinishedHeadingLabel=ติดตั้ง {#AppName} เสร็จแล้ว
thai.FinishedLabel=เหลือขั้นสุดท้ายใน Chrome ทำครั้งเดียว (Chrome ไม่ให้โปรแกรมทำแทน):%n%n1. ในหน้า chrome://extensions ที่เปิดไว้ให้ เปิดสวิตช์ "Developer mode" มุมขวาบน%n2. กด "Load unpacked"%n3. คลิกช่องที่อยู่ด้านบนของหน้าต่าง กด Ctrl+V (คัดลอกไว้ให้แล้ว) แล้ว Enter → Select Folder%n4. กดไอคอนจิ๊กซอว์บนแถบ Chrome → ปักหมุด {#AppName} → กดไอคอน%n%nก่อนใช้งาน ล็อกอิน ChatGPT และ Google Flow ใน Chrome ไว้%nเคยติดตั้งแล้ว (อัปเดต) ข้ามขั้นนี้ได้ · ทำซ้ำได้จากไอคอน "{#AppName} - ตั้งค่า Chrome" บนเดสก์ท็อป

[Tasks]
Name: "desktopicon"; Description: "สร้างไอคอนบนเดสก์ท็อป"
Name: "installchrome"; Description: "ดาวน์โหลดและติดตั้ง Google Chrome (เครื่องนี้ยังไม่มี — จำเป็นต้องใช้)"; Check: not ChromeInstalled
Name: "localvoice"; Description: "ระบบเสียงในเครื่อง: เสียงไทย F5-TTS · เทรนเสียงตัวเอง · ถอดเสียง Whisper (ดาวน์โหลด ~5GB ใช้เวลานาน · ไม่ติ๊กก็ใช้เสียง Edge ได้)"; Flags: unchecked; Check: HasNvidia

[Files]
Source: "{#Src}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Dirs]
Name: "{app}\projects"

[Icons]
Name: "{autoprograms}\{#AppName}\เปิด {#AppName}"; Filename: "{app}\เปิดโปรแกรม.bat"; WorkingDir: "{app}"; IconFilename: "{app}\extension\icons\dhamma-auto.ico"
Name: "{autoprograms}\{#AppName}\ตั้งค่า Chrome extension อีกครั้ง"; Filename: "{app}\ติดตั้งครั้งแรก.bat"; WorkingDir: "{app}"; IconFilename: "{app}\extension\icons\dhamma-auto.ico"
Name: "{autoprograms}\{#AppName}\ปิดโปรแกรม"; Filename: "{app}\ปิดโปรแกรม.bat"; WorkingDir: "{app}"
Name: "{autoprograms}\{#AppName}\โฟลเดอร์งานคลิป"; Filename: "{app}\projects"
Name: "{autoprograms}\{#AppName}\อ่านก่อนใช้งาน"; Filename: "{app}\อ่านก่อนใช้งาน.txt"
Name: "{autoprograms}\{#AppName}\ถอนการติดตั้ง {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\เปิดโปรแกรม.bat"; WorkingDir: "{app}"; IconFilename: "{app}\extension\icons\dhamma-auto.ico"; Tasks: desktopicon
; ไว้บนเดสก์ท็อปด้วย ให้ลูกค้าหาเจอง่ายเวลา Chrome หลุดการเชื่อม / ยังไม่ได้ทำ Load unpacked
Name: "{autodesktop}\{#AppName} - ตั้งค่า Chrome"; Filename: "{app}\ติดตั้งครั้งแรก.bat"; WorkingDir: "{app}"; IconFilename: "{app}\extension\icons\dhamma-auto.ico"; Tasks: desktopicon

[Run]
; ลงทะเบียน native host + เปิดหน้า chrome://extensions + คัดลอกที่อยู่โฟลเดอร์ extension ลงคลิปบอร์ด
Filename: "{app}\runtime\node\node.exe"; Parameters: """{app}\native\install.mjs"" --no-wait --no-shortcut"; WorkingDir: "{app}"; StatusMsg: "กำลังลงทะเบียนกับ Chrome..."; Flags: runhidden waituntilterminated
; ระบบเสียงในเครื่อง — เปิดหน้าต่างแยกให้เห็นความคืบหน้า (นาน) ไม่ขวางตัวติดตั้ง
; ใส่ py launcher ที่เพิ่งลงไว้หน้า PATH เอง (หน้าต่างนี้สืบ PATH เก่าของตัวติดตั้ง)
Filename: "{cmd}"; Parameters: "/k chcp 65001 >nul & set ""PATH={localappdata}\Programs\Python\Launcher;%PATH%"" & powershell -NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\setup-tts.ps1"""; WorkingDir: "{app}"; Flags: nowait; Tasks: localvoice

[UninstallRun]
Filename: "{app}\ปิดโปรแกรม.bat"; Parameters: "--quiet"; WorkingDir: "{app}"; Flags: runhidden waituntilterminated; RunOnceId: "StopDhamma"
Filename: "{app}\runtime\node\node.exe"; Parameters: """{app}\native\install.mjs"" --uninstall"; WorkingDir: "{app}"; Flags: runhidden waituntilterminated; RunOnceId: "UnregisterHost"

; ไฟล์ที่โปรแกรมสร้างเองตอนใช้งาน — ลบได้ · งานคลิป (projects) ตัวละคร การตั้งค่า และ .env (API key) เก็บไว้ให้ลูกค้า
[UninstallDelete]
Type: files; Name: "{app}\native\host.bat"
Type: files; Name: "{app}\native\com.dhamma_auto.bridge.json"
Type: files; Name: "{app}\bridge\bridge.log"
Type: files; Name: "{app}\bridge\jobs*.json"
Type: filesandordirs; Name: "{app}\tts\.venv"
Type: filesandordirs; Name: "{app}\refs"

[Code]
var
  DownloadPage: TDownloadWizardPage;
  ChromeDownloaded, PythonDownloaded: Boolean;

function ChromeInstalled: Boolean;
begin
  Result := RegKeyExists(HKCU, 'SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe')
    or RegKeyExists(HKLM, 'SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe')
    or FileExists(ExpandConstant('{localappdata}\Google\Chrome\Application\chrome.exe'))
    or FileExists(ExpandConstant('{commonpf64}\Google\Chrome\Application\chrome.exe'))
    or FileExists(ExpandConstant('{commonpf32}\Google\Chrome\Application\chrome.exe'));
end;

function HasNvidia: Boolean;
begin
  Result := FileExists(ExpandConstant('{sys}\nvidia-smi.exe'));
end;

function Python310Installed: Boolean;
begin
  Result := RegKeyExists(HKCU, 'Software\Python\PythonCore\3.10')
    or RegKeyExists(HKLM, 'Software\Python\PythonCore\3.10');
end;

procedure InitializeWizard;
begin
  DownloadPage := CreateDownloadPage(SetupMessage(msgWizardPreparing), 'กำลังดาวน์โหลดโปรแกรมที่ต้องใช้...', nil);
end;

{ ดาวน์โหลดก่อนเริ่มติดตั้ง — ล้มเหลวก็ติดตั้งต่อได้ แค่บอกให้ลงเองทีหลัง }
function NextButtonClick(CurPageID: Integer): Boolean;
var
  Count: Integer;
begin
  Result := True;
  if CurPageID <> wpReady then Exit;
  ChromeDownloaded := False;
  PythonDownloaded := False;
  Count := 0;
  DownloadPage.Clear;
  if WizardIsTaskSelected('installchrome') then
  begin
    DownloadPage.Add('https://dl.google.com/chrome/install/latest/chrome_installer.exe', 'chrome_installer.exe', '');
    Count := Count + 1;
  end;
  if WizardIsTaskSelected('localvoice') and not Python310Installed then
  begin
    DownloadPage.Add('https://www.python.org/ftp/python/3.10.11/python-3.10.11-amd64.exe', 'python-3.10.11-amd64.exe', '');
    Count := Count + 1;
  end;
  if Count = 0 then Exit;
  DownloadPage.Show;
  try
    try
      DownloadPage.Download;
      ChromeDownloaded := WizardIsTaskSelected('installchrome');
      PythonDownloaded := WizardIsTaskSelected('localvoice') and not Python310Installed;
    except
      MsgBox('ดาวน์โหลดไม่สำเร็จ (' + GetExceptionMessage + ')' + #13#10 +
        'ติดตั้งโปรแกรมต่อได้ — Chrome ลงเองได้จาก google.com/chrome · ระบบเสียงในเครื่องลงทีหลังได้จาก ติดตั้งครั้งแรก.bat',
        mbInformation, MB_OK);
    end;
  finally
    DownloadPage.Hide;
  end;
end;

{ ปิดโปรแกรมรุ่นเก่าที่รันอยู่ก่อนวางไฟล์ทับ (ไฟล์ที่กำลังใช้งานวางทับไม่ได้) }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Rc: Integer;
begin
  Result := '';
  if FileExists(ExpandConstant('{app}\ปิดโปรแกรม.bat')) then
    Exec(ExpandConstant('{app}\ปิดโปรแกรม.bat'), '--quiet', ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Rc);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Rc: Integer;
begin
  if CurStep <> ssInstall then Exit;
  if ChromeDownloaded then
  begin
    WizardForm.StatusLabel.Caption := 'กำลังติดตั้ง Google Chrome...';
    if not Exec(ExpandConstant('{tmp}\chrome_installer.exe'), '/silent /install', '', SW_SHOW, ewWaitUntilTerminated, Rc) or not ChromeInstalled then
      MsgBox('ติดตั้ง Chrome ไม่สำเร็จ — ลงเองจาก google.com/chrome แล้วเปิด ติดตั้งครั้งแรก.bat ในเมนู Start', mbInformation, MB_OK);
  end;
  if PythonDownloaded then
  begin
    WizardForm.StatusLabel.Caption := 'กำลังติดตั้ง Python 3.10 สำหรับระบบเสียงในเครื่อง...';
    Exec(ExpandConstant('{tmp}\python-3.10.11-amd64.exe'),
      '/quiet InstallAllUsers=0 Include_launcher=1 InstallLauncherAllUsers=0 PrependPath=0 Include_test=0 Include_doc=0',
      '', SW_SHOW, ewWaitUntilTerminated, Rc);
  end;
end;

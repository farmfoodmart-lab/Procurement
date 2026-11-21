# สร้างทางลัด "รายการจัดซื้อ" บนเดสก์ท็อป โดยใช้ตำแหน่งโฟลเดอร์ปัจจุบัน
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$name = "รายการจัดซื้อ"
$title = "ติดตั้งทางลัด - $name"
$target = Join-Path $dir "Procurement.html"

if (-not (Test-Path $target)) {
  [System.Windows.Forms.MessageBox]::Show("ไม่พบไฟล์ Procurement.html ในโฟลเดอร์นี้`n$dir", $title, "OK", "Error") | Out-Null
  exit 1
}

$answer = [System.Windows.Forms.MessageBox]::Show("ต้องการสร้างทางลัด `"$name`" บนเดสก์ท็อปหรือไม่?", $title, "YesNo", "Question")
if ($answer -ne "Yes") { exit 0 }

try {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $ws = New-Object -ComObject WScript.Shell
  $lnk = $ws.CreateShortcut((Join-Path $desktop "$name.lnk"))
  $lnk.TargetPath = $target
  $lnk.WorkingDirectory = $dir
  $lnk.IconLocation = (Join-Path $dir "logo.ico") + ",0"
  $lnk.Description = $name
  $lnk.Save()
  [System.Windows.Forms.MessageBox]::Show("สร้างทางลัด `"$name`" บนเดสก์ท็อปเรียบร้อยแล้ว", $title, "OK", "Information") | Out-Null
} catch {
  [System.Windows.Forms.MessageBox]::Show("สร้างทางลัดไม่สำเร็จ`n$($_.Exception.Message)", $title, "OK", "Error") | Out-Null
  exit 1
}
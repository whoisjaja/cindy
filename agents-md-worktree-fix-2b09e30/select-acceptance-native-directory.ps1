param([int]$OwnerProcessId,[string]$Directory)
$ErrorActionPreference='Stop'
$full=[System.IO.Path]::GetFullPath($Directory)
$fixture=[System.IO.Path]::GetFullPath('C:\Users\XD\AppData\Local\Temp\cindy-agents-md-desktop-7LoO5P')
if(-not $full.StartsWith($fixture+'\',[System.StringComparison]::OrdinalIgnoreCase)){throw 'Not an acceptance directory'}
if(-not (Test-Path -LiteralPath $full -PathType Container)){throw 'Missing acceptance directory'}
Add-Type -AssemblyName UIAutomationClient
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class AcceptanceDialogNative {
 [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr window,int id);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr window,uint msg,IntPtr w,string value);
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window,uint msg,IntPtr w,IntPtr l);
}
"@
$root=[System.Windows.Automation.AutomationElement]::RootElement
$condition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty,$OwnerProcessId)
$dialogCondition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty,'#32770')
$dialog=$null
for($attempt=0; $attempt -lt 50 -and -not $dialog; $attempt++) {
 foreach($window in $root.FindAll([System.Windows.Automation.TreeScope]::Children,$condition)) {
  if($window.Current.ClassName -eq '#32770') { $dialog=$window; break }
  $dialog=$window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$dialogCondition)
  if($dialog) { break }
 }
 if(-not $dialog) { Start-Sleep -Milliseconds 100 }
}
if(-not $dialog){throw 'No native dialog belonging to acceptance Desktop'}
$handle=[IntPtr]$dialog.Current.NativeWindowHandle
$edit=[AcceptanceDialogNative]::GetDlgItem($handle,1152)
$button=[AcceptanceDialogNative]::GetDlgItem($handle,1)
if($edit -eq [IntPtr]::Zero -or $button -eq [IntPtr]::Zero){throw 'Missing native folder controls'}
[void][AcceptanceDialogNative]::SendMessage($edit,12,[IntPtr]::Zero,$full)
if(-not [AcceptanceDialogNative]::PostMessage($button,245,[IntPtr]::Zero,[IntPtr]::Zero)){throw 'Cannot select folder'}

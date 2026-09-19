param([int]$RootPid)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
function Sum-Available($rows,$field){
 $values=@($rows | ForEach-Object {if($null -ne $_.$field){$_.$field}})
 if($values.Count -eq 0){return $null}
 return ($values | Measure-Object -Sum).Sum
}
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class SdaProcessCounters {
 [StructLayout(LayoutKind.Sequential)] public struct IO {public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes;}
 [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
 [DllImport("kernel32.dll")] static extern bool GetProcessIoCounters(IntPtr h,out IO io);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 public static IO? Read(int pid){var h=OpenProcess(0x1000,false,pid);if(h==IntPtr.Zero)return null;try{IO io;return GetProcessIoCounters(h,out io)?(IO?)io:null;}finally{CloseHandle(h);}}
}
'@
$previous=@{}
while(Get-Process -Id $RootPid -ErrorAction SilentlyContinue){
 $start=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
 $all=Get-CimInstance Win32_Process
 $ids=[Collections.Generic.HashSet[int]]::new();$null=$ids.Add($RootPid)
 do {$changed=$false;foreach($p in $all){if($ids.Contains([int]$p.ParentProcessId)){$changed=$ids.Add([int]$p.ProcessId)-or $changed}}}while($changed)
 $rows=@();$next=@{};$unavailable=@()
 foreach($taskPid in $ids){
  try {$p=Get-Process -Id $taskPid;$io=[SdaProcessCounters]::Read($taskPid);$cpu=$p.TotalProcessorTime.TotalMilliseconds;$key="$taskPid/$($p.StartTime.Ticks)";$old=$previous[$key]
   $elapsed=if($old){[Math]::Max(1,$start-$old.time)}else{0}
   $row=@{pid=$taskPid;name=$p.ProcessName;workingSetBytes=$p.WorkingSet64;privateBytes=$p.PrivateMemorySize64;cpuPercent=$null;readBytesPerSecond=$null;writeBytesPerSecond=$null;ioScope='process transfer bytes (file/device), not physical disk bytes'}
   if($elapsed){$row.cpuPercent=[Math]::Max(0,($cpu-$old.cpu)*100/$elapsed);if($io -and $old.io){$row.readBytesPerSecond=[Math]::Max(0,($io.readBytes-$old.io.readBytes)*1000/$elapsed);$row.writeBytesPerSecond=[Math]::Max(0,($io.writeBytes-$old.io.writeBytes)*1000/$elapsed)}}
   $next[$key]=@{time=$start;cpu=$cpu;io=$io};$rows+=[pscustomobject]$row
  }catch{$unavailable+=@{pid=$taskPid;reason=$_.Exception.Message}}
 }
 $previous=$next
 $cpuTotal=Sum-Available $rows 'cpuPercent'
 $machine=if($null -ne $cpuTotal){$cpuTotal/[Environment]::ProcessorCount}else{$null}
 @{time=$start;processes=@($rows);unavailable=$unavailable;cpuPercent=$cpuTotal;totalMachinePercent=$machine;workingSetBytes=(Sum-Available $rows 'workingSetBytes');readBytesPerSecond=(Sum-Available $rows 'readBytesPerSecond');writeBytesPerSecond=(Sum-Available $rows 'writeBytesPerSecond');includesCollector=$true}|ConvertTo-Json -Depth 5 -Compress
 Start-Sleep -Milliseconds 1000
}

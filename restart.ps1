$conns = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
foreach ($c in $conns) {
  $p = Get-Process -Id $c.OwningProcess
  if ($p.ProcessName -eq 'node') { Stop-Process -Id $p.Id; Write-Host "Stopped old node (PID $($p.Id))" }
  else { Write-Host "Port 3000 is used by $($p.ProcessName). Not touching it."; exit 1 }
}
node server.js
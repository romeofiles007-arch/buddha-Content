# Temple and eight-spoke Dharma wheel; matches extension/icons/cartoon-auto.svg.
# System.Drawing only. No network, API keys, or dependencies.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$iconOutput = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../extension/icons'))
[IO.Directory]::CreateDirectory($iconOutput) | Out-Null

function Add-OriginMetadata([string]$path) {
  $pngBytes = [IO.File]::ReadAllBytes($path)
  $data = [Text.Encoding]::ASCII.GetBytes("Source`0Original temple and Dharma wheel vector; extension/icons/cartoon-auto.svg; rendered by scripts/build-dhamma-icons.ps1; no external image source.")
  $typeAndData = [Text.Encoding]::ASCII.GetBytes('tEXt') + $data
  [uint32]$crc = [uint32]::MaxValue
  foreach ($value in $typeAndData) {
    $crc = $crc -bxor $value
    for ($bit = 0; $bit -lt 8; $bit++) {
      $crc = if ($crc -band 1) { ($crc -shr 1) -bxor [uint32]3988292384 } else { $crc -shr 1 }
    }
  }
  $crc = $crc -bxor [uint32]::MaxValue
  $lengthBytes = [BitConverter]::GetBytes([uint32]$data.Length)
  $crcBytes = [BitConverter]::GetBytes($crc)
  if ([BitConverter]::IsLittleEndian) { [Array]::Reverse($lengthBytes); [Array]::Reverse($crcBytes) }
  $output = [IO.MemoryStream]::new()
  try {
    $output.Write($pngBytes, 0, $pngBytes.Length - 12)
    $output.Write($lengthBytes, 0, 4)
    $output.Write($typeAndData, 0, $typeAndData.Length)
    $output.Write($crcBytes, 0, 4)
    $output.Write($pngBytes, $pngBytes.Length - 12, 12)
    [IO.File]::WriteAllBytes($path, $output.ToArray())
  } finally { $output.Dispose() }
}

function RoundedPath([single]$x, [single]$y, [single]$w, [single]$h, [single]$radius) {
  $path = [Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $radius * 2
  $path.AddArc($x, $y, $diameter, $diameter, 180, 90)
  $path.AddArc($x + $w - $diameter, $y, $diameter, $diameter, 270, 90)
  $path.AddArc($x + $w - $diameter, $y + $h - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($x, $y + $h - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

$backgroundBrush = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#8f301d'))
$goldBrush = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#f4ca78'))
$ivoryBrush = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#fff5db'))
$wheelPen = [Drawing.Pen]::new($ivoryBrush, 3)
$wheelPen.StartCap = [Drawing.Drawing2D.LineCap]::Round
$wheelPen.EndCap = [Drawing.Drawing2D.LineCap]::Round
$master = [Drawing.Bitmap]::new(1024, 1024)
$graphics = [Drawing.Graphics]::FromImage($master)
try {
  $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.ScaleTransform(8, 8)
  $background = RoundedPath 0 0 128 128 28
  try { $graphics.FillPath($backgroundBrush, $background) } finally { $background.Dispose() }
  $roof = [Drawing.PointF[]]@(
    [Drawing.PointF]::new(24,65), [Drawing.PointF]::new(35,61),
    [Drawing.PointF]::new(57,39), [Drawing.PointF]::new(64,16),
    [Drawing.PointF]::new(71,39), [Drawing.PointF]::new(93,61),
    [Drawing.PointF]::new(104,65), [Drawing.PointF]::new(100,73),
    [Drawing.PointF]::new(64,48), [Drawing.PointF]::new(28,73)
  )
  $graphics.FillPolygon($goldBrush, $roof)
  foreach ($rect in @(@(35,74,7,24,1.5), @(86,74,7,24,1.5), @(30,98,68,5,1.5), @(23,105,82,6,2))) {
    $path = RoundedPath $rect[0] $rect[1] $rect[2] $rect[3] $rect[4]
    try { $graphics.FillPath($goldBrush, $path) } finally { $path.Dispose() }
  }
  $graphics.DrawEllipse($wheelPen, 50, 64, 28, 28)
  $graphics.DrawLine($wheelPen, 64, 64, 64, 92)
  $graphics.DrawLine($wheelPen, 50, 78, 78, 78)
  $graphics.DrawLine($wheelPen, [single]54.1, [single]68.1, [single]73.9, [single]87.9)
  $graphics.DrawLine($wheelPen, [single]54.1, [single]87.9, [single]73.9, [single]68.1)
  $graphics.FillEllipse($ivoryBrush, [single]60.5, [single]74.5, 7, 7)

  $icoSizes = @(16, 24, 32, 48, 64, 128, 256)
  foreach ($size in ($icoSizes + @(512))) {
    $png = [Drawing.Bitmap]::new($size, $size)
    $resize = [Drawing.Graphics]::FromImage($png)
    try {
      $resize.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $resize.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $resize.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
      $resize.DrawImage($master, 0, 0, $size, $size)
      $png.Save((Join-Path $iconOutput "icon-$size.png"), [Drawing.Imaging.ImageFormat]::Png)
      Add-OriginMetadata (Join-Path $iconOutput "icon-$size.png")
      Write-Output "Created icon-$size.png"
    } finally { $resize.Dispose(); $png.Dispose() }
  }

  # PNG-backed multi-resolution ICO, supported by modern Windows.
  $icoPath = Join-Path $iconOutput 'dhamma-auto.ico'
  $stream = [IO.File]::Create($icoPath)
  $writer = [IO.BinaryWriter]::new($stream)
  try {
    $writer.Write([uint16]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]$icoSizes.Count)
    $offset = 6 + 16 * $icoSizes.Count
    foreach ($size in $icoSizes) {
      $bytes = [IO.File]::ReadAllBytes((Join-Path $iconOutput "icon-$size.png"))
      $dimension = if ($size -eq 256) { 0 } else { $size }
      $writer.Write([byte]$dimension)
      $writer.Write([byte]$dimension)
      $writer.Write([byte]0)
      $writer.Write([byte]0)
      $writer.Write([uint16]1)
      $writer.Write([uint16]32)
      $writer.Write([uint32]$bytes.Length)
      $writer.Write([uint32]$offset)
      $offset += $bytes.Length
    }
    foreach ($size in $icoSizes) {
      $writer.Write([IO.File]::ReadAllBytes((Join-Path $iconOutput "icon-$size.png")))
    }
  } finally { $writer.Dispose(); $stream.Dispose() }
  Copy-Item -LiteralPath $icoPath -Destination (Join-Path $iconOutput 'icon-128.ico') -Force
  Write-Output 'Created dhamma-auto.ico and updated icon-128.ico (7 resolutions).'
} finally {
  $graphics.Dispose()
  $master.Dispose()
  $wheelPen.Dispose()
  $backgroundBrush.Dispose()
  $goldBrush.Dispose()
  $ivoryBrush.Dispose()
}

Add-Type -AssemblyName System.Speech

$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
$recognizer.SetInputToDefaultAudioDevice()

$recognizer.add_SpeechRecognized({
  param($senderObject, $payload)
  if($payload.Result.Confidence -ge 0.45){
    [Console]::Out.WriteLine((ConvertTo-Json @{ type = 'result'; text = $payload.Result.Text; confidence = [math]::Round($payload.Result.Confidence, 3) } -Compress))
    [Console]::Out.Flush()
  }
})
$recognizer.add_RecognizeCompleted({
  param($senderObject, $payload)
  if($payload.Error){
    [Console]::Out.WriteLine((ConvertTo-Json @{ type = 'error'; message = $payload.Error.Message } -Compress))
    [Console]::Out.Flush()
  }
})

[Console]::Out.WriteLine('{"type":"ready"}')
[Console]::Out.Flush()
$recognizer.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)

while($true){
  $command = [Console]::In.ReadLine()
  if($null -eq $command -or $command -eq 'stop'){ break }
}

$recognizer.RecognizeAsyncCancel()
$recognizer.RecognizeAsyncStop()
$recognizer.Dispose()
[Console]::Out.WriteLine('{"type":"stopped"}')
[Console]::Out.Flush()

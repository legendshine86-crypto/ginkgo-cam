# PC가 카메라 주소를 올릴 때 쓰는 '권한 좁은' 키를 만들어 프로필 ntr-refresh 로 저장한다 (관리자 키로 한 번만 실행)
# 이 키로는 state/cams.json 쓰기와 화면 찍기 Lambda 실행만 할 수 있어요
$ErrorActionPreference = "Continue"
$aws = (Get-Command aws -ErrorAction SilentlyContinue).Source
if (-not $aws) { $aws = "C:\Program Files\Amazon\AWSCLIV2\aws.exe" }
$Region = "ap-northeast-2"
$User = "now-that-road-refresher"
$Bucket = (Get-Content (Join-Path $PSScriptRoot "deploy-config.json") -Raw | ConvertFrom-Json).bucket
$Account = (& $aws sts get-caller-identity --query Account --output text)

& $aws iam get-user --user-name $User 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { & $aws iam create-user --user-name $User | Out-Null; Write-Host "사용자를 만들었어요: $User" }
$policy = '{"Version":"2012-10-17","Statement":[' +
  '{"Effect":"Allow","Action":"s3:PutObject","Resource":"arn:aws:s3:::' + $Bucket + '/state/cams.json"},' +
  '{"Effect":"Allow","Action":"lambda:InvokeFunction","Resource":"arn:aws:lambda:' + $Region + ':' + $Account + ':function:now-that-road-capture"}]}'
$tmp = New-TemporaryFile; Set-Content $tmp $policy -Encoding ascii
& $aws iam put-user-policy --user-name $User --policy-name refresh-only --policy-document "file://$tmp"
Remove-Item $tmp

# 예전 키는 지우고 새로 만들어요
foreach ($k in (& $aws iam list-access-keys --user-name $User --query "AccessKeyMetadata[].AccessKeyId" --output text).Split("`t ") | ? { $_ }) {
  & $aws iam delete-access-key --user-name $User --access-key-id $k
}
$key = & $aws iam create-access-key --user-name $User --output json | ConvertFrom-Json
& $aws configure set aws_access_key_id $key.AccessKey.AccessKeyId --profile ntr-refresh
& $aws configure set aws_secret_access_key $key.AccessKey.SecretAccessKey --profile ntr-refresh
& $aws configure set region $Region --profile ntr-refresh
Write-Host "프로필 ntr-refresh 에 좁은 권한 키를 저장했어요"

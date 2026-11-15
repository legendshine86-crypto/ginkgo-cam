# AWS(서울)에 화면 찍기 Lambda를 만들거나 고쳐 올린다. 여러 번 실행해도 괜찮아요.
# 준비: aws configure (리전 ap-northeast-2, 관리자 키). 카메라 주소는 PC의 tools/refresh-cams.mjs가 넣어요
# aws 명령의 성공 여부는 $LASTEXITCODE로 확인해요 (Stop으로 두면 PowerShell 5.1이 aws의 안내 문구까지 오류로 봐요)
$ErrorActionPreference = "Continue"
$aws = (Get-Command aws -ErrorAction SilentlyContinue).Source
if (-not $aws) { $aws = "C:\Program Files\Amazon\AWSCLIV2\aws.exe" }
$Region = "ap-northeast-2"
$Root = Split-Path $PSScriptRoot -Parent
$ConfFile = Join-Path $PSScriptRoot "deploy-config.json"
$Fn = "now-that-road-capture"
$Role = "now-that-road-capture-role"
$Rule = "now-that-road-every-5min"

function A { & $aws @args --region $Region; if ($LASTEXITCODE -ne 0) { throw "aws $($args -join ' ') 실패" } }
function Exists { & $aws @args --region $Region 2>$null | Out-Null; return ($LASTEXITCODE -eq 0) }

$Account = (& $aws sts get-caller-identity --query Account --output text)
if ($LASTEXITCODE -ne 0) { throw "AWS 로그인이 안 돼 있어요. aws configure를 먼저 해 주세요" }

# ---------- 버킷 ----------
if (Test-Path $ConfFile) { $conf = Get-Content $ConfFile -Raw | ConvertFrom-Json } else {
  $conf = [pscustomobject]@{ bucket = "now-that-road-cam-" + -join ((48..57 + 97..102) | Get-Random -Count 8 | % { [char]$_ }) }
  $conf | ConvertTo-Json | Set-Content $ConfFile -Encoding utf8
}
$Bucket = $conf.bucket
if (-not (Exists s3api head-bucket --bucket $Bucket)) {
  A s3api create-bucket --bucket $Bucket --create-bucket-configuration LocationConstraint=$Region | Out-Null
  Write-Host "버킷을 만들었어요: $Bucket"
}
# 공개는 spots.json, snap/, thumb/ 만. state/ (카메라 주소)와 deploy/ 는 비공개로 둬요
A s3api put-public-access-block --bucket $Bucket --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false"
$policy = @{ Version = "2012-10-17"; Statement = @(@{ Sid = "PublicRead"; Effect = "Allow"; Principal = "*"; Action = "s3:GetObject";
  Resource = @("arn:aws:s3:::$Bucket/spots.json", "arn:aws:s3:::$Bucket/snap/*", "arn:aws:s3:::$Bucket/thumb/*") }) } | ConvertTo-Json -Depth 5 -Compress
$tmp = New-TemporaryFile; Set-Content $tmp $policy -Encoding ascii
A s3api put-bucket-policy --bucket $Bucket --policy "file://$tmp"
$cors = '{"CORSRules":[{"AllowedOrigins":["*"],"AllowedMethods":["GET","HEAD"],"AllowedHeaders":["*"],"MaxAgeSeconds":300}]}'
Set-Content $tmp $cors -Encoding ascii
A s3api put-bucket-cors --bucket $Bucket --cors-configuration "file://$tmp"

# ---------- 권한(역할) ----------
if (-not (Exists iam get-role --role-name $Role)) {
  Set-Content $tmp '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' -Encoding ascii
  A iam create-role --role-name $Role --assume-role-policy-document "file://$tmp" | Out-Null
  A iam attach-role-policy --role-name $Role --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  Write-Host "역할을 만들었어요. 적용되도록 10초 기다려요"; Start-Sleep 10
}
Set-Content $tmp ('{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:GetObject","s3:PutObject"],"Resource":"arn:aws:s3:::' + $Bucket + '/*"}]}') -Encoding ascii
A iam put-role-policy --role-name $Role --policy-name s3-access --policy-document "file://$tmp"
$RoleArn = "arn:aws:iam::${Account}:role/$Role"

# ---------- 코드 묶기 ----------
Copy-Item (Join-Path $Root "capture\spots.json") (Join-Path $PSScriptRoot "spots.json") -Force
$zip = Join-Path $env:TEMP "now-that-road-lambda.zip"
if (Test-Path $zip) { Remove-Item $zip }
# Compress-Archive는 경로에 \ 를 넣어서 리눅스(Lambda)에서 깨질 수 있어 tar로 zip을 만들어요
Push-Location $PSScriptRoot; tar -a -c -f $zip index.mjs spots.json bin; Pop-Location
if ($LASTEXITCODE -ne 0) { throw "zip 만들기 실패" }
A s3 cp $zip "s3://$Bucket/deploy/lambda.zip" --only-show-errors

$envJson = @{ Variables = @{ BUCKET = $Bucket } } | ConvertTo-Json -Compress
Set-Content $tmp $envJson -Encoding ascii

if (-not (Exists lambda get-function --function-name $Fn)) {
  A lambda create-function --function-name $Fn --runtime nodejs22.x --handler index.handler --role $RoleArn `
    --code "S3Bucket=$Bucket,S3Key=deploy/lambda.zip" --memory-size 1024 --timeout 300 --ephemeral-storage Size=1024 `
    --environment "file://$tmp" --architectures x86_64 | Out-Null
  Write-Host "Lambda를 만들었어요"
} else {
  A lambda update-function-code --function-name $Fn --s3-bucket $Bucket --s3-key deploy/lambda.zip | Out-Null
  A lambda wait function-updated --function-name $Fn
  A lambda update-function-configuration --function-name $Fn --environment "file://$tmp" --timeout 300 --memory-size 1024 | Out-Null
  Write-Host "Lambda를 고쳐 올렸어요"
}
A lambda wait function-updated --function-name $Fn
Remove-Item $tmp

# ---------- 5분마다 실행 ----------
$FnArn = "arn:aws:lambda:${Region}:${Account}:function:$Fn"
A events put-rule --name $Rule --schedule-expression "rate(5 minutes)" --state ENABLED | Out-Null
& $aws lambda add-permission --region $Region --function-name $Fn --statement-id every-5min --action lambda:InvokeFunction `
  --principal events.amazonaws.com --source-arn "arn:aws:events:${Region}:${Account}:rule/$Rule" 2>$null | Out-Null
A events put-targets --rule $Rule --targets "Id=capture,Arn=$FnArn" | Out-Null

Write-Host ""
Write-Host "완료: https://$Bucket.s3.$Region.amazonaws.com/spots.json"
